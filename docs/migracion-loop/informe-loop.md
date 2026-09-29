# Loop 4 Readymix (Loop for Readymix / Readymix360): descripción funcional completa

Informe armado solo con material público: centro de ayuda archivado en Wayback, GitBook archivado, sitios comerciales (el actual y los archivados), changelogs, videos de YouTube con transcripción, fichas de App Store y Google Play, y el revendedor del Reino Unido. **No se usó ninguna cuenta de Loop.** Fecha: 29/09/2026.

**Cómo leer las marcas:**
- **(C: X)** = confirmado por la fuente X. Las claves de fuente están en la sección 11.
- **(I)** = inferido a partir de capturas o del contexto. No está escrito textualmente en ninguna fuente.
- **IMG:** es una captura local de `img/`, relativa a esta carpeta.

---

## 0. Resumen ejecutivo

- **Qué es.** Loop es un SaaS 100% en la nube para hormigoneras (C: WEB24-FAQ). Se entra por `app.loop4.io` con email y contraseña (C: WEB24-FAQ).
  - El núcleo es logístico: pedido → planificación → tickets → despacho con arrastrar y soltar → seguimiento GPS → auditoría → cierre del día → facturación.
  - Sobre ese núcleo se agregaron módulos: calidad (Loop QC), combustible (Loop Fuel), CRM/embudo de ventas (Loop CRM), remito digital (Loop E‑Ticket / Digital Ticket), fórmulas y costos, y apps con la marca de cada cliente (C: WEB25, WEB25-discover).
- **Filosofía.** "Solo basta despachar": los indicadores salen solos del despacho más el GPS (C: YT-panel, WEB24).
  - Se integra con lo que el cliente ya tiene: GPS, sistema de batch, ERP, reloj de personal y tanques de combustible (C: WEB24-FAQ).
  - La puesta en marcha lleva 1–2 semanas integrando GPS y batch (C: WEB24-FAQ).
- **Unidad central de operación.** El **ticket/remito**: un viaje de un mixer, con m³ y hora. La planificación genera N tickets separados según el tiempo de descarga, y el despacho los asigna a camiones (C: A2, IMG gerenciador_tickets_gantt.png).
- **Entidad comercial central.** El **Proyecto** (antes "Contrato"): "un proyecto es a la vez contrato y obra" (C: YT-contratos, WEB24). Tiene cliente, dirección de obra, contactos (con WhatsApp), tabla de precios propia, productos permitidos y adicionales parametrizados.
- **Diferenciales comerciales.**
  - Dashboard con **benchmark** contra el promedio y el "Top 5" de toda la base de clientes (C: CL-dic23, YT-informes).
  - Más de 50 informes (C: WEB24, YT-informes).
  - Seguimiento del **ralenti en planta** (C: BLOG-ralenti).
  - App del cliente con marca propia más notificaciones por WhatsApp (C: WEB25).
- **Precio (2021, Readymix360).** Por camión: Starter US$99/mes con 5 camiones; Advanced US$299 con 10; Enterprise US$699 con 20. El camión adicional cuesta US$25/30/35 (C: RM21-home).
  - En 2024 "se paga por camión", sin contrato ni penalidad (C: WEB24-FAQ).
  - Loop QC en preventa: USD 5 por camión por mes durante 1 año, en vez de 10 (C: WEB24-QC).
- **Empresa.** Loop 4 Solutions Ltda ME, Brasil (C: IOS). Fundador: Walney Seixas (C: YT "ReadyMix 360 – Presentation").
  - Dicen tener clientes en 16 países y 4 continentes, y más de 250 empresas en el benchmark (C: WEB24, YT-informes).
  - Clientes en Argentina: HDI Hormigones (Neuquén), Grupo Tejamax (Córdoba), Holcim Hormigones, Corralón El Mercado, Horcrisa, LFR, Pavisur, Hormaco, Hormilas, Oro Gris, Siajsa, entre otros (C: IOS/GP).
  - Representante en Argentina: Ing. Ricardo Villanueva (C: BLOG-HDI).

---

## 1. Mapa de módulos y menú

### 1.1 Menú lateral por versión

| Versión / fecha | Menú (en orden) | Fuente |
|---|---|---|
| v2.26–2.27, mayo 2023 (PT) | Home, Dashboard, Pedidos, Programações, Despacho, Painel de Operações, Mapa Avançado, Análise de Dados, Auditoria de Entregas, Auditoria de vendedores, Bomba, Análise do Combustível, Relatórios, Finanças, Controle de Qualidade, Contratos, Administração | C: IMG despacho_pantalla_principal.png |
| v2.262, dic 2023 (ES) | Inicio, Dashboard, Pedidos, Planificaciones, **Calendario**, Despacho, Panel de Control, Mapa Avanzado, Análisis de Datos, Auditoría de Entregas, Bomba, Análisis de Combustible, Informes, Finanzas, **Ventas**, Administración | C: IMG informes_produccion_es.png |
| v2.262 (EN) | Home, Statistics, Orders, Planned Orders, Calendar, Dispatch, Operational Panel, Advanced Map, Data Analysis, Delivery Audit, Pump, Fuel Analysis, Reports, Finance, Sales, Administration | C: IMG reports_production_en.png |
| v2.346–2.502, 2024 (ES) | …, Auditoría de Entregas, **Auditoría de Carga**, Auditoría de Vendedores, Bomba, Análisis de Combustible, Informes, Finanzas, **Control de Calidad**, **Proyectos** (antes "Contratos"), Ventas, Administración | C: IMG informes_financieros.png, informes_ventas.png |

**Barra superior** (C: capturas):
- Suporte / Help Desk (hoy Gleap; antes Intercom).
- Configurações / Ajustes.
- Sair.
- Versión (ej. "V 2.508.1").

**Colecciones del centro de ayuda** en ES (C: HC-es): Inicio Rápido, Pedidos, Órdenes de compra, Planificación, Despacho, Gerenciador de Remito, Panel de Control, Mapa Avanzado, Auditoría de Entregas, Bombas, Finanzas, Control de Calidad, Proyecto, Administración, Integrations, Changelogs, Informes, Soporte Remoto (AnyDesk), Ajustes, **Gestor de Lead**, **Análisis de combustible**.

**Índice GitBook en PT** (C: GBP):
- Pedidos, Programação, Despacho, Painel de Operações, Mapa Avançado, Auditoria de Entregas.
- Bomba: Programação de Bomba y Operações de Bombas.
- Finanças: Faturamento, Fechamento de Remessas, Venda e Notas.
- Controle de Qualidade: Tabelas de Fórmulas, Pontos de Carga, Laboratório, Tipo de Amostra, Tipo de Inspeção.
- Contratos.
- Administração: Clientes, Produtos, Vendedores, Motoristas, Finalidade, Usuários, Veículos, Plantas, Cercas Geográficas, Tarifas, Status, Formas de Pagamento, Condições de Pagamento.
- Videos.

**Artículos en inglés del revendedor UK** (C: FW): Quickstart, Orders, Purchase Orders, Planned Orders, Dispatch, Ticket Manager, Operational Panel, Advanced Map, Delivery Audit, Pump Planning (id 8), Pump Operation, Raw Material Cost Table, **Price Table**, Sale and Notes, Day Delivery Closings (id 33), Billing, Inspection Type, Sample Type, Laboratory, Loading Points, Formulas Tables, Projects, Payment Condition, Payment Methods, Status Record, **Taxes**, Geofences, Plants, Vehicle, Users, Drivers.

### 1.2 Productos o "suites" que venden hoy

Fuente: WEB25 y WEB25-discover (C).
- Órdenes, Planificación, Despacho, Panel de control, Facturación, Control de calidad, Gestión de combustible y Auditorías.
- Módulos que se venden aparte: Loop CRM, Loop QC, Loop E‑Ticket y Loop Fuel.
- Además: Comparativa/benchmark, App para clientes con marca propia y Automatizaciones de WhatsApp.

### 1.3 Diagrama de conexión entre módulos (I)

```
CRM (Lead → Propuesta) ──► PROYECTO/CONTRATO (cliente+obra+precios+productos+adicionales+contactos)
                                   │                                   ▲
                    Orden de compra (OC) del cliente ───────────────────┤
                                   ▼                                   │
PEDIDO (fecha, hora, planta, productos, bomba, status) ──► PLANIFICACIÓN/PROGRAMACIÓN (reglas de entrega)
                                                              │  genera
                                                              ▼
                                                  TICKETS (1 por viaje: m³ + hora)  ◄── Gerenciador de Tickets
                                                              │  drag&drop
                                                              ▼
                        DESPACHO ──► línea al BATCH (fórmula/materiales) ──► Auditoría de Carga
                           │   └──► impresión remito, notif. App cliente + WhatsApp, ERP
                           ▼
                     ENTREGA/REMITO (viaje GPS: carga→ida→obra→descarga→vuelta→planta)
                           │
         Panel de Control / Mapa / Auditoría de Entregas / Dashboard / Análisis / Informes
                           ▼
                  CIERRE DEL DÍA (verificar remitos + procesar adicionales) ──► FACTURACIÓN ──► ERP
                  QC: muestras por remito (plan de moldeo) → ensayos → certificados (App cliente)
                  Fuel: cargas de gasoil por camión (odómetro/horómetro) → litros/m³
```

---

## 2. Módulos, uno por uno

### 2.1 Home / Inicio
- Existe como primera entrada del menú (C: capturas). No hay documentación de su contenido. Por la URL `app.loop4.io/home?date=…` que abre Despacho, parece que Home es la pantalla de Despacho o un selector de día (I; C: IMG despacho_tooltip_programacion_url.png).

### 2.2 Pedidos (Orders)

**Pantalla de lista** (C: GBP; IMG pedidos_lista_semana.png, site_pedidos_lista.png):
- Accesos rápidos: "Semana Passada / Semana Atual / Próxima Semana" y una tira con los días de la semana.
- Filtros: **Usina/Planta**, **Status**, **Tipo** (ej. "Ready Mix") y **Período**; botón Buscar.
- Columnas: # Pedido (con ícono de carpeta azul si nació de un contrato), Contrato/Proyecto, Endereço, Quantidade Total, Data de Entrega, Criado Em, Observações.
  - En la versión en inglés también: Classification ("Primary"), Customer y Status ("Approved" con ícono editable).
- Columnas personalizables: # Pedido, Cod. Interno, Tipo, Classificação, Usina, Contrato, Cliente, Endereço, Vendedor, Quantidade Total, Detalhes, Produto, Bomba, Finalidade, Data de Entrega, Criado Em, Observações, Status (C: IMG pedidos_columnas.png).
- Acciones por fila: menú ⋮ (Imprimir Pedido, Histórico do Status, Programações), clave de la app del cliente, editar y borrar. Botones generales: Adicionar Pedido y Exportar (C: GBP).

**Botón "Resumo"** (C: GBP; IMG pedidos_resumen_grafico_demanda.png):
- Se elige planta y fecha. Muestra Volume Total, Total de Entregas, Total de Clientes, Ciclo médio, Entregas/Veículo y Volume/Veículo.
- Muestra también el **Gráfico de Demanda**: camiones necesarios por franja de 30 min, entre las 06:00 y las 19:00.
- Tiene un selector **"Trabalhando com: N"** camiones para comparar la demanda con la capacidad (C).

**Formulario "Novo Pedido"** (C: GBP, IMG pedido_form_nuevo.png):
1. **Data:** Data de Entrega*, Hora*, Vendedor, Planta.
2. **Cliente y Endereço:** checkbox "Vincular Contrato", Cliente*, Contrato*.
3. **Detalhes do Pedido:** Ordem de Compra, Finalidade (ej. "Coluna"), Status* (ej. "Aprovado"), Observações do Cliente, Observações (internas).
4. **Produtos:**
   - Checkbox "Mostrar preço na entrega".
   - Tabla Concreto: producto, cantidad en m³ y precio.
   - Tabla Serviço de Bomba: Quantidade, Preço, **Qtd. Mín.** y **Preço Mín.** (mínimo de bombeo).
   - Otros productos y servicios.
- Botones: "Salvar e Fechar" y **"Salvar e Programar"**. Este último solo se habilita si el pedido tiene únicamente productos de concreto (C: GBP).

**Reglas y otros datos:**
- Los pedidos pueden venir del ERP o del equipo de ventas (C: RM21-planning). También se pueden pedir desde la app del cliente: "It is now possible to place concrete orders directly through the app!" (C: IOS My ReadyMix).
- Si el status tiene la marca "Proibido programar", el pedido no se puede programar (C: A48).

### 2.3 Órdenes de compra (Purchase Orders)
- **Lista** (C: CL-ene24; IMG ordenes_compra.png): # Pedido (con ícono $), Proyecto, Dirección, Cantidad Total, Fecha Entrega, Creado En, Notas. Filtros: fecha de creación y "Solo Anuladas". Botones: Añadir Pedido y Exportar.
- **Anular y reactivar:** una OC anulada se ve con una franja roja y deja de aparecer en las búsquedas de OC de Despacho, Programación y Pedido. Tiene historial de estado (C: CL-ene24).
- La OC se referencia desde el pedido, la programación, el despacho y la venta manual (C: IMG pedido_form_nuevo.png, vendas_notas_form.png, planificaciones_planta_menu.png).
- (I) Sería la orden de compra del cliente, con un volumen total que van consumiendo las entregas (cupo). Eso explica la columna "Cantidad total".

### 2.4 Planificaciones / Programações (Planned Orders)

**Concepto.** Una planificación es la ejecución programada de un pedido o proyecto en un día y una planta: producto, volumen, bomba y reglas de entrega. De ella salen los tickets. Se puede programar desde la pantalla de Contrato o desde la pantalla de Programación (C: A51).

**Pantalla "Planificaciones de Planta <planta>"** (C: CL-nov23, CL-ene24, CL-mar24; IMG planificaciones_planta_menu.png, planificaciones_resumen_duplicar.png, site_programaciones_planned_orders.png):
- **Panel izquierdo "Pedidos":** selector "Pedidos em Curso", rango de fechas y búsqueda. Cada tarjeta muestra fecha y hora, producto (ej. "FCK 20.0 BRITA 0+1 SLUMP 1…"), Planned Volume 0/48 m³, Delivered Volume 8/48 m³, status ("Liberado") y Created At.
- **Resumen arriba**, en tres bandas: **No Planificado / Planificado / Entregue**. Cada una con Volumen Total, Entregas Totales, Total Clientes, Ciclo promedio, Entregas/Vehículo y Volumen/Vehículo.
- **Tarjetas de servicios de bomba del día:** ej. "SERVICIO DE BOMBA P/HORMIGON (POR M3) Mañana:2 Tarde:1".
- **Botones:**
  - **Planificación Multipunto**: probablemente una entrega repartida en varios destinos, del tipo "Programação Multiponto / MULTIDRP01" (I; C: IMG informe_notas_hormigon.png).
  - **Planificación del Proyecto**: crear una planificación nueva.
  - **Reserva de Planificación** y **Eliminar reservas**: reservar capacidad o turno sin tener todavía el pedido completo (I).
  - **Duplicar Planificaciones**: selección múltiple y elección de la fecha destino (C: CL-ene24).
  - Exportar, **Raw Materials** (Excel de materias primas necesarias), **Blank Map** y **Production Map** (impresión del mapa de producción, en blanco o lleno; C: RM21-changelog "print blank programming").
- **Columnas:** marca de confirmada (👍), checkbox, En Obra (hora de llegada), # Pedido, Proyecto, Dirección, Producto, Volumen (m³), Bomba, Notas.
- **Tabla por planta:** Plant, Made Del., Planned Del., Orders, Delivery Vol. (m³), Planned…
- **Menú por fila:** Órdenes de Compra, **Otros Productos & Servicios** (se pueden agregar después de iniciada la planificación; los ya despachados quedan bloqueados; C: CL-nov23), Duplicar Planificación, Historial. Íconos: deshacer, ubicación en el mapa, editar y borrar.
- **Ícono "Revisar discrepancia de precio en el contrato":** compara el precio del contrato con el de la planificación y ofrece "Actualizar todos los precios" (C: CL-mar24; IMG precios_divergentes.png).

**Formulario "Planificación del Proyecto" / "Programação de Contrato"** (C: IMG programacao_contrato_form.png, planificacion_cambiar_status.png, reglas_entrega_sugerencia_llegada.png, buscar_proyecto.png; CL-dic23; RM21-planning; YT-programar):
- **Datos Generales:**
  - Proyecto/Contrato*, con búsqueda avanzada por código, nombre, cliente o dirección (hay clientes con 2.855 proyectos).
  - Cliente, enlaces "Clave de App" y "Contactos del Proyecto".
  - Dirección*: desplegable con las direcciones del proyecto, que muestra calle, número, barrio, CP, ciudad y provincia.
  - Vendedor.
  - **Status**: botón que abre "Cambiar Status" con justificación obligatoria si así se configura. Ejemplos: Anulado, Aprobado, BLOQUEADO, Default Status (C: CL-oct23).
  - Finalidad (ej. Coluna/Columna: el elemento estructural a hormigonar).
- **Control de Calidad:** Tipo de Inspección, Regla de Inspección, **m³ entre inspecciones**.
- **Datos de Planificación:**
  1. Fecha de entrega, con botones Hoy/Mañana/Pasado mañana, y Planta*.
  2. **Hormigón**: producto y volumen.
  3. **Bomba**: servicio de bombeo. Camiones y bomba se planifican "en un solo paso" (C: WEB24).
  4. **Otros Productos & Servicios**: agregar producto (instalación de bomba, fibra, aditivos, hielo…).
  5. **Reglas de entrega:**
     - "Obtener tiempo de viaje automáticamente".
     - **Llegada Obra*** (ej. 07:00), con el **Inicio Carga** calculado debajo (ej. 06:20) en rojo si hay conflicto.
     - Configuración: **Tiempo efectivo de carga** (ej. 10 min) y **Puntos de carga** (ej. 1).
     - **Sugerencia de llegada** para evitar conflictos de carga (ej. 06:55 o 07:55) y checkbox "Aplicar sugerencia". La sugerencia se calcula con los atrasos o conflictos de la primera carga de cada planificación (C: CL-dic23).
     - **Tiempo de ir (min)** (ej. 20) y un campo **"… por m³"** (ej. 8). Se muestra un **Tiempo Total** (ej. 64 min).
     - Según RM21, también se configuran el tiempo de vertido (pouring), la frecuencia, el tiempo en ruta y el volumen máximo por viaje.
     - Los valores por defecto se toman del histórico de viajes (C: YT-programar) y de los valores estándar de la planta (C: A45).
- **Mientras se planifica** se arman en tiempo real el **gráfico de demanda de camiones** y el **gráfico de bomba**, comparando demanda con capacidad (C: YT-programar).

**Estados de una programación** (C: A2, CL-dic23; IMG despacho_menu_programacion.png):
- Confirmada o desconfirmada (👍), suspendida/pausada (con descripción obligatoria), finalizada, reabierta y cancelada (borde amarillo y pestaña "Planificaciones Canceladas").
- Además, el status configurable de Administración > Status, con las marcas proibido programar/despachar y cancelar (C: A48).

### 2.5 Gerenciador de Tickets / de Remitos (Ticket Manager)

Se abre desde la tarjeta de programación en Despacho (C: A2; IMG gerenciador_tickets_gantt.png).
- **Encabezado:** # Pedido, Contrato (código y nombre), Producto (código y nombre), cliente, dirección, teléfono, Vendedor, Finalidad y Notas.
- **Volumen:** "0.00 / 45 m³" (entregado / total editable).
- **Botones:**
  - **Ajustar Ticket para Horário Atual**: recalcula los horarios desde el momento actual.
  - **Adicionar Tickets Faltantes**: agrega tickets por el volumen que falta.
  - **Remover Tickets Excedentes**: quita tickets por el volumen que sobra.
- **Configurações de Tiempo** (acordeón):
  - Desplazamiento en pasos de N minutos (ej. 5 min) con flechas.
  - Campos: Início do Carregamento, Saída da Planta para a Obra, Na Obra, Tempo Total de Descarga, Saída da Obra, Retorno à Planta.
- **Gantt:** una fila por ticket, con los m³ editables (10, 10, 10, 10, 5) y un eje horario. Cada barra tiene 4 colores: **gris = carga, celeste = ida, amarillo = descarga en obra (m³), verde = vuelta**. Los tickets quedan escalonados por el tiempo de descarga (C: IMG).
- "+ Adicionar Ticket", borrar un ticket, Ocorrências y Salvar.
- **Regla (C: conocida + IMG):** el volumen total se divide en tickets de hasta la capacidad del camión (máximo por viaje). Cada ticket nuevo arranca cuando el anterior termina de descargar, para que el hormigonado sea continuo.

### 2.6 Despacho (Dispatch)

**Pantalla** (C: A2, A51, CL-*; IMG despacho_pantalla_principal.png, site_despacho_web.png):
- **Encabezado:**
  - **Contadores del día:** 7 íconos con valores, por ejemplo "74,0 | 137,5 | 185,8% | 0,0 | 0,0 | 47,0 | 8,0".
    - El ícono ⊘ muestra "Volumen Cancelado: 47 m³" (C: IMG despacho_planificaciones_canceladas.png).
    - (I) El resto serían: m³ programado, m³ despachado, % de avance, m³ pendiente, m³ suspendido/pausado, m³ cancelado y m³ adicional/extra.
  - Botón de descarga, Fecha, **Planta**, **Punto de Carga** e ícono de planta (configuración del punto de carga o fórmulas; I).
- **Columna "Tickets / Remitos":**
  - Refresco, exportar a Excel, y engranaje con "Mostrar nombre del cliente", "Mostrar nombre del endereço" y "Mostrar código del producto" (C: A2, CL-feb24).
  - Cada tarjeta muestra el número de pedido, el ícono de bomba si es bombeado, **n/N** (ej. 5/10) y 👍 si está confirmado. También cliente, obra o código de contrato, producto, **m³ > hora de carga** y los íconos de nota e información.
  - **Borde rojo = atrasado** respecto de la hora programada (C: A2). **Borde amarillo = programación cancelada** (C: CL-dic23). Barra izquierda de color = color de la programación (I).
- **Columna "Betoneiras / Mixers":**
  - Contador naranja de alertas, filtro por estado (**Na planta, Em viagem, Manutenção, Sem motorista, Reserva**; C: IMG despacho_filtro_betoneiras.png), botón nube (sincronizar GPS; I) y "+".
  - El "+" abre "Betoneiras da Planta": lista doble de disponibles y seleccionados, "Selecionar Todos", y las opciones Adicionar / Limpar e adicionar todos los vehículos de la empresa (C: A2; IMG despacho_betoneiras_de_planta.png).
  - Cada tarjeta muestra:
    - Código del camión (BT003 / "BT378 FROTA 2039") y la señal de GPS.
    - **Tiempo en el estado actual** (ej. 24h+, 03h42, 41min) y **tiempo de viaje o ciclo** (⏱ 02h17).
    - Motorista (volante) y, si corresponde, obra o cliente actual (pin).
    - Planta, distancia (ej. 5.00 KM) y patente.
    - Borde de color según el estado: verde, amarillo, azul o gris. Según el Panel: gris = cargando, azul = yendo a obra, amarillo = en obra, verde = volviendo (C: RM21-cl-nov21).
    - Ícono "!" naranja de alerta.
  - Regla: un vehículo cargando más de 2 h sale de operación y vuelve a disponibles (C: RM21-cl-nov21).
- **Columna "Programações / Planificaciones":**
  - Filtro "De: planta", ✓ para ver las finalizadas y ⊘ para ver las canceladas.
  - Cada tarjeta muestra pedido y código de contrato, cliente/obra, **entregado/total m³** (ej. 14/35 m³), 👍 si está confirmada, ícono de puntualidad (ej. "Llegada del primer camión retrasada 89 min"; C: CL-ene24), ⓘ con el detalle copiable, y ⋮.
  - El ⓘ muestra: Chegada Obra, # Pedido, Contrato, Cliente, Endereço, Telefone, Código y Nome do Produto, Volume Total, Finalidade, Vendedor, Observações y Contatos do Contrato (C: IMG despacho_tooltip_programacion_url.png).
  - **Menú ⋮** (C: A2, CL-ene24; IMG despacho_menu_programacion.png, despacho_menu_planificacion_v2288.png):
    - Chave do Aplicativo do Cliente: código de 9 dígitos XXX-XXX-XXX por contrato, con "Copiar" y "Resetar" (C: IMG despacho_chave_app_cliente.png).
    - Confirmar / Desconfirmar Programação.
    - Suspender / Pausar Programação: descripción obligatoria, ej. "Cancelado por lluvia" (IMG despacho_suspender_programacion.png).
    - Finalizar Programação: después ya no se puede modificar.
    - Reabrir Programação.
    - Ver todas las entregas.
    - **Ocorrências** (historial de incidencias): columnas Origen, Hora, Ocurrencia, Detalles, Descripción, Motivo, Leído; botón "Adicionar ocorrência" (IMG ocorrencias.png).
    - **Logs de Aprobaciones**.
    - Detalles.
    - **Enviar Mensagem**: el cliente lo lee en su app (IMG despacho_enviar_mensaje.png).
    - **Nota de Serviço**.
    - **Formulario de bombeo**.
    - Abrir Gerenciador de Tickets.
    - **Fechamento do Dia / Cierre Diario**.
    - **Justificar retraso en la programación**.

**Acción de despacho** (C: A2, YT-despacho; IMG despacho_form_entrega.png):
- Se **arrastra el ticket hasta un camión** y se abre el diálogo "Entrega". Ahí se ven cliente y dirección, con un botón al contacto del cliente.
- **Campos:**
  - Veículo* (checkbox "Mostrar todos os veículos") y Motorista*.
  - Data de Início* y Horário de Início* (checkbox "Usar hora do ticket").
  - Ponto de Carga*.
  - **Lacre** (precinto) y **Volume dentro do Veículo** (sobrante que ya trae; I).
  - Producto de Concreto, con Qtd* en m³ y Status.
  - Serviço de Bomba (o "Produto não possui serviço de bomba").
  - Opciones: agregar o quitar **asistente(s)** del chofer (C: A2), notas para el chofer (C: RM21-cl-nov21) y la clave de la app del chofer.
- Botones **Despachar** y **Despachar e Imprimir**. Al despachar (C: YT-despacho):
  1. Se imprime el remito/ticket para el cliente.
  2. Se envía la línea de despacho al **sistema de batch**, con la fórmula y los materiales.
  3. Arranca el seguimiento logístico por GPS.
  4. Se envía la información administrativa a Loop o al ERP.
  5. Se notifica al cliente por la app y por **WhatsApp**.
- **Bloqueos:**
  - Status "Proibido despachar" (C: A48).
  - **Límite de crédito**: si el cliente tiene marcado "Limitar al alcanzar el límite", no se despacha el volumen que lo exceda (C: A19).
  - Aviso de discrepancia de precio (C: CL-mar24).

**Tabla "Entregas"**, debajo del despacho y también como pantalla propia (C: A2; IMG entregas_tabla.png, entregas_iconos_retraso.png):
- **Columnas:** Caminhão, Motorista, Cod. Entrega, N° Entrega, N° Remito, # Pedido, Contrato/Proyecto, Cliente, Produto, Volume, Início, Saída, Em Obra, Volta, Chegada, Ciclo. Exportar; columnas configurables.
- **Íconos por fila:** editar, registros, camión (abre la **ruta**), ● verde/rojo de puntualidad, **retraso en carga** y **retraso en llegar a obra** (C: CL-dic23), imprimir, clonar/copiar y borrar.
- **Registros:** auditoría de creación y edición: usuario, acción, volumen y fecha (C: CL-oct23; IMG entrega_registros_edicion.png).
- **Mapa de ruta del viaje** (C: A2, CL-nov23; IMG entrega_mapa_ruta.png, viaje_grafico_velocidad_sensores.png):
  - Mapa Leaflet. Línea azul = ida, línea verde = vuelta, punto azul = minutos parado en obra, **punto rojo = parada fuera del perímetro de la obra**.
  - Botón para compartir: link público del viaje terminado (C: RM21-cl-dic21).
  - Pestañas: **Info Viagem** (Início Carga, Indo Obra, Na Obra, Início Descarga, Fim Descarga, Voltando à Planta, Chegada na Planta, Tempo Total, Data, Contrato, Cliente, Endereço, Produto, Caminhão, Motorista), **Velocidade** (gráfico con escala de tiempo y avisos de "demasiados puntos enviados" o "no se enviaron puntos"), **Altitude**, **Sensor do Balão/globo**, **Volumen de agua** y **Rotación de globos**.
  - Las últimas pestañas son para trompos con sensores de rotación o agua (C: IMG). La integración de sensores no está documentada.

**Fechamento do Dia / Cierre del día**, desde Despacho o desde Finanzas (C: A2; IMG fechamento_do_dia.png, site_cierre_del_dia.png):
- **Filtros:** cliente, planta, período y engranaje. Botones **Confirmar Remessas Pendentes** y **Processar Adicionais**.
- **Por cliente:** "Valor Total", contadores $ (con precio / facturable; I), ⏱ pendientes, ✓ verificadas y ✗ rechazadas.
- **Por proyecto:** Adicionar Nota y Processar Adicionais.
- **Filas por remito:** código de entrega (P001-106), n.º de pedido/programación (0001-38), hora, camión, producto, m³, precio unitario y total. Incluye líneas "No Delivery" para Pump rental o PUMPING SERVICE (servicios sin viaje).
- Acciones por línea: ✓ verificar, ✗ rechazar, ⋮.
- **Pie:** "0 / 3 Verificadas", **Fechar Dia** y **Fechar e Bloquear Dia**.
- **Objetivo:** controlar lo entregado antes de cobrar entregas, adicionales y bombas (C: A2).

### 2.7 Panel de Control / Painel de Operações (Operational Panel)

(C: WEB24, WEB25, YT-panel, RM21-cl-nov21/dic21, UK; IMG site_panel_operaciones_web.png, site_panel_operaciones_timeline.png)
- **Barra superior:** contadores con íconos (retorno/reserva 0, mantenimiento 20, sin motorista 0), dos selectores de planta, m³ total del día (211.5) y la pestaña **Live Trips**.
- **Herramientas:** búsqueda, orden por hora ascendente o descendente, y filtros por motorista, planta, bomba y camión.
- **Filtros por estado con contadores:** **Loading (2), To Job, On Job, To Plant** (en PT: Cargando, En viaje, En obra, Regresando). Colores (2021): gris = cargando, azul = ida a obra, amarillo = en obra, verde = vuelta a planta.
- **Una fila por viaje en curso:**
  - Camión (BT214 FROTA 2078), chofer y código de obra/proyecto (G77).
  - **Línea de tiempo:** Loading → To Job → On Job → To Plant → At Plant, con la hora de cada hito, la duración entre hitos (30 min, 30 min, 38 min…) y un **cronómetro** del tramo en curso (00:23:03).
  - Íconos de camión con señal GPS.
  - A la derecha: velocidad (km/h), km a la obra o a la planta, km totales y tiempo total.
  - Íconos para fijar (pin) y editar.
- "Sin necesidad de geocercas" se ven los horarios clave; al hacer clic se ven la ubicación y la ruta (C: YT-panel).
- **Puntos rojos** = paradas fuera de obra, por tráfico o no autorizadas. También demoras excesivas en obra.
- Vista **esquemática o de mapa** (C: YT-panel, WEB25).
- **Configuraciones:**
  - **Alerta de vencimiento del hormigón** en minutos: viajes cuyo tiempo desde la carga hasta salir de obra supera el umbral pasan a estado de alerta, con su filtro (C: RM21-cl-nov21).
  - Agrupar por planta.
  - Mostrar el nombre del cliente o del proyecto (C: RM21-cl-dic21).
  - En el mapa del panel, ver los mixers disponibles en planta.
- **Qué muestra según el revendedor UK:** alerta de paradas no autorizadas, tiempo en cada etapa, camiones en mantenimiento, sin chofer, disponibles, en viaje y en ralenti dentro de la planta.
- Existe también en la app móvil ("Painel de Operações" en amarillo; C: IMG site_app_cliente_mockups.png).

### 2.8 Mapa Avanzado (Advanced Map)
- Distribución geográfica de las entregas y **mapa de calor** (C: WEB24, YT-informes).
- Filtro **"Solo bombeado"** (C: CL-nov23).
- En el revendedor UK (base Wialon) se habla de "Live Map" con unidades en tiempo real (C: UK). (I) Tendría filtros por período, planta, producto y cliente.

### 2.9 Análisis de Datos (Data Analysis)
- **Filtros** (C: CL-jun24; IMG analisis_datos_filtros.png): "Todas las Plantas" (multiselección), Período*, franjas rápidas (00‑06, 06‑12, 12‑18, 18‑00, 00‑12, 12‑00, 00‑00), hora desde–hasta y checkbox **"Entre plantas"**.
- **Pestañas:** **Camión, Planta, Proyecto, Cliente, Conductor**, y más.
- **Indicadores:** volumen entregado, distancia, cantidad de viajes, tiempo ocioso y ciclos; todo exportable (C: CL-jun24).
- 2021: pestaña Cliente, y **D & T**, que separa la cantidad de entregas con viaje, las entregas y los viajes (C: RM21-cl-nov21).

### 2.10 Dashboard / Statistics

(C: CL-dic23, CL-ene24, CL-mar24, CL-oct23, RM21-changelog; IMG dashboard_*.png, site_dashboard_benchmark_carga.png)
- **Filtros:** dos selectores (empresa o planta), "Seleccionar Mes", botones de mes (Diciembre/Enero) y **30 días**.
- **Pestaña Eficiencia:** Volumen/Remito (m³), Volumen/Conductor (m³), Minutos/m³ y más.
- **Pestaña Producción:** Remitos despachados, Volumen (m³) y Clientes, cada uno con total, promedio y hoy.
- **Pestaña Logística:** Ciclo promedio diario, Tiempo promedio de carga diario, Tiempo promedio en ruta y Promedio en obra.
- **Pestaña Tiempo de Ralenti:** Ralenti en planta por viaje, Ralenti por planta, Conductores con menores ralentíes y Conductores con mayores ralentíes.
- **Cada gráfico** es una serie diaria del mes. Muestra "Prom", "Hoy", la variación en % contra el benchmark y contra el Top 5, y el **Benchmark | Top 5**. El benchmark es el promedio de las 5 empresas con mejor desempeño del sistema (C: CL-dic23).
- **Configuraciones:**
  - Cómo cuentan los sábados: día completo, medio día (peso 0,5) o se ignoran (C: CL-oct23).
  - **Ignorar vehículos de terceros** (C: CL-mar24).
- 2021: gráfico proporcional por día con clic para ver el detalle, rango deseable configurable, gráfico de tiempo en cliente y gráfico de puntualidad (C: RM21-changelog).

### 2.11 Auditoría de Entregas (Delivery Audit)

(C: CL-oct23, CL-mar24, RM21-cl-nov21/dic21, YT-auditoria; IMG site_auditoria_entregas.png, auditoria_entregas_columnas.png)
- **Filtros:** búsqueda, Plantas (una o varias), Período con horas desde–hasta, **Tipo** ("Todos, Entrega regular, …" y "Entrega con Cambio de Planta"; en 2021 también "Error trips") y engranaje.
- **Checkboxes:** **Inconsistencias**, **Audit Pending**, **Audit in Progress**, **Internal Notes**, **Stop Alert** (paradas) y **Job Time Alert > 90 min** (umbral de tiempo en obra configurable; C: CL-oct23).
- Botones **Procesar viajes** y Export (Excel).
- **Resumen:** m³ (207.50), camiones (8), m³/camión (25.94), ciclo (109.05), km promedio (31.41), minutos en obra (47.76), y otros (viajes, entregas, alertas, inconsistencias, cambios de planta).
- **Tabla en dos bloques:**
  - **DATOS ERP / ENTREGAS:** Truck, Date, Delivery ID, Client, Project, Address, Volume, Inicio.
  - **DATOS GPS / VIAJES:** Tipo, Cargando (min), Fuera (hora de salida), **En obra (min)**, Llegada, Ciclo, Distancia y **Dif. Dist.** (diferencia de km entre ida y vuelta; C: CL-oct23).
  - Columnas personalizables: ID Entrega, Cliente, Proyecto, Dirección, Latitud, Longitud, Cargando, Dif. Dist., Conductor, N° Remito.
- **Detecta** (C: YT-auditoria): viajes sin remito, remitos sin viaje GPS asociado, paradas no autorizadas y viajes con cambio de planta. También alerta de **geocercas prohibidas**: el chofer paró en un lugar marcado como prohibido (C: RM21-cl-dic21).

### 2.12 Auditoría de Carga (Load Audit)

(C: CL-mar24, YT-auditoria, WEB24; IMG auditoria_carga_batch.png, site_auditoria_cargas_erp.png)
- **Filtros:** búsqueda, planta, punto de carga, período, checkbox "Replanteados" (I: tickets re-programados), Exportar a Excel y Buscar.
- **Resumen:** remitos (14), cargas (14), m³ de entregas (108) y m³ de batch (108), y desvíos (7).
- **Categorías con contador:** **Sin Entrega** (carga sin remito), **Sin Carga** (remito sin carga), **Dif. Volumen**, **Desviación** (lo cargado contra la fórmula), **Materiales Faltantes** y **Materiales Excedentes**.
- **Tabla doble:** "DATOS ERP / ENTREGAS" (Cod. Entrega, **Batch Status**, Producto, Volumen Producción, Inicio) contra "DATOS BATCH / CARGAS" (Cod. Interno, Inicio Carga, Volumen, Producto). Íconos por fila para ver el detalle de materiales (I).
- También detecta **cargas manuales** y desvíos entre lo deseado y lo real (C: WEB24).

### 2.13 Auditoría de Vendedores
- Aparece en el menú desde 2023 (C: capturas). No hay documentación.
- (I) Controlaría la actividad o las ventas por vendedor, en relación con los informes "Informes del Vendedores" y con el CRM.

### 2.14 Bomba (Pump)
- **Pantalla "Pedidos de Bomba"** (C: CL-nov23; IMG bomba_programacion_gantt.png):
  - Panel izquierdo: rango de fechas y búsqueda por n.º de pedido, producto o barrio.
  - Grupos: **Pedidos com Erro, Cancelados/Bloqueados, Pedidos Alocados, Pedidos não Alocados**. Cada tarjeta muestra cliente, fecha y hora, #pedido, m³, $ y status.
  - Panel derecho: selector del servicio de bomba (ej. "SERVICIO DE BOMBA P/HORMI…") y un **Gantt por bomba** con la escala de horas del día. Cada fila tiene editar, borrar y "+".
  - Botones "Copiar" (día), fecha y "+ Adicionar".
  - Colores de barra (I): azul = traslado, amarillo = bombeo, verde = retorno.
- **Artículos existentes:** Pump Planning (id 8) y Pump Operation (C: FW). También "Operações de Bombas" (C: GBP).
- **App del bombista:** "Pump Driver APP" en el plan Enterprise (C: RM21-home). Existe un **Formulario de bombeo** en el menú de la programación (C: CL-ene24).
- **Productos relacionados** (C: A39): "Serviços de Bomba" (valor por defecto $ o %), "Taxa mínima de Bomba" (producto de tarifa mínima) y "Complemento de Bomba" (tipo de producto). En el pedido: cantidad, precio, cantidad mínima y precio mínimo.
- La planta se puede definir como **planta de bomba** (C: IMG planta_form_geocerca.png).

### 2.15 Análisis de Combustible / Loop Fuel

(C: WEB25, WEB25-discover; IMG site_combustible_web.png, site_app_combustible.png)
- **Pantalla web "Fuel Management":**
  - Filtros: Restock Date, Vehicle Type ("Betoneira") y vehículo. Botón Add.
  - Columnas: **Date/Time, Previous Supply, Odometer, Hourmeter, Liters, Time, Volume, Km** y más. (I) El volumen serían los m³ transportados desde la carga anterior; salen indicadores de L/h, L/km y **L/m³**.
- **App móvil**, con pestañas Tanques, Abastecimento, Histórico y Configurações:
  - **Recebimento de Combustível** en un tanque (litros).
  - **Abertura / Fechamento de Bomba** del surtidor (lectura del medidor, litros y foto).
  - **Abastecimento de Caminhão**: se escanea el **QR del vehículo** o se elige a mano, se cargan los litros y se sacan fotos.
  - Cada registro tiene estado "Online" (sincronizado).
- **Integración** con sistemas de tanques de combustible (C: WEB24-FAQ, testimonio de Hormax).
- **Beneficio declarado:** −0,25 L de gasoil por m³ despachado (C: WEB25).

### 2.16 Informes / Relatórios (Reports)

"Más de 50 informes", todos exportables (C: YT-informes). Tienen favoritos (★) y algunos se pueden **programar por email** (ícono de calendario azul; C: IMG informes_produccion_es.png; "Advanced daily email reports" en RM21-home). Se generan con motor **jsreport** (report.readymix.io; C: RM-report), en PDF o Excel.
- **Informes de Producción** (C: IMG informes_produccion_es.png): Producción por Cliente/Planta, Hoja de Despacho, **Otros Productos & Servicios** (tarifas de bomba y m³ faltante; en PDF por plantas y períodos; C: A94), General de la Planta, **Reporte de Consumo de Cemento por Fórmula**, **Reutilización** (hormigón devuelto y reutilizado; I), Producción por cliente, Producción por Conductor, Producción por Punto de Carga, Producción de Planta, Producción de planta resumen, Resumen de producción (Hormigón), Producción por Producto, Producción por Proyecto, Producción de Camión, Producción de Camión Detallada, Productividad de la semana, **Volumen entregado por camión** (por mes, con m³/mes; C: CL-ene24; IMG informe_volumen_por_camion.png).
- **Informes de Planificación** (C: IMG informes_planificacion.png): Ocurrencias (incluye los retrasos y sus justificaciones), Vistoria de Programações, **Puntualidad**, Planificaciones Canceladas, **Infracciones por Planificaciones**, Planificaciones Por Fecha, **Productos de la Planificación** (tipo, descripción y cantidad; C: CL-dic23), Programación de Bombas.
- **Reportes Financieros** (C: IMG informes_financieros.png): **Notas de Hormigón** (todas las entregas con fecha, hora, volumen, remito, código y nombre del proyecto y dirección; C: CL-jun24, IMG informe_notas_hormigon.png), Remitos, Facturación por cliente, Facturación por cliente V2, Facturación por Planta, Entregas por Clientes (Detalles), Ventas por Planta, Ventas por Proyecto, Ventas por Proyecto Detallado.
- **Otras categorías:** Informes de Bombeo, Informes del Conductores (ralenti por chofer, día y planta; C: BLOG-ralenti), Informes de Cargas, Control de Calidad, **Informes de Ventas** (**Costo por Producto**, con código, producto y costo por planta; C: CL-feb24; e Informes del Vendedores), Otros Informes, Exportar a Excel e Informes de Datos (C: IMG informes_ventas.png, informes_financieros.png).
- **Correos diarios automáticos** de indicadores: "Loop Morning" aparece entre los marcadores internos (I; C: IMG despacho_tooltip_programacion_url.png).

### 2.17 Finanzas (Finance)

Según el video, gestiona remitos, cierres diarios y la preparación de la facturación (C: YT-finanzas).
- **Cierre del día / Fechamento de Remessas / Day Delivery Closings:** ver la sección 2.6.
- **Facturación / Billing** (C: CL-mar24; IMG facturacion_por_proyecto.png):
  - Bloques por proyecto ("000002003 – nombre"), con cliente y dirección, búsqueda y **"Generar Facturación"**.
  - Filas con checkbox: Cod. Interno (remito), **Número de Factura**, Número, Fecha, Planta, Pedido, Producto, Cantidad, **Código de Fórmula**, Precio Total, Cod Entrega, Contrato.
  - Las líneas canceladas se ven con ✗ rojo, estado (ej. "Producto cancelado") y notas (ej. "COMPLEMENTO").
  - Total del bloque.
  - Luego se genera un informe de facturación con los conceptos a facturar, integrable con el ERP (C: YT-finanzas).
- **Venta y Notas / Sale and Notes** (venta manual, sin despacho) (C: IMG vendas_notas_form.png):
  - Cabecera: Cod. Interno, Série, Número, Data*, Planta*, Ponto de Carga, Cliente*, "Vincular Contrato" y Endereço*.
  - Líneas: Veículo, Motorista, Produto (ej. "Serviço de Bomba Lança"), Ordem de Compra, Qtd., Preço y Total, más primer, segundo y tercer asistente.
  - Total. Botones "Salvar e Imprimir" y "Salvar e Fechar".
- **Tabla de Precios / Price Table** (C: FW; WEB24: "Administramos el pricing con nuestras tablas de fórmulas"). Cada proyecto puede tener su propia tabla de precios (C: YT-contratos).
- **Tabla de Costos de materias primas / Raw Material Cost Table** (C: CL-mar24; IMG tabla_costo.png):
  - Campos: Código Interno, Nombre*, Planta*, **Tarifa de Servicio*** y **Margen*** (%).
  - Lista de Materias-Primas con unidad (LTR, KGM, MLT) y costo.
  - "Importar Tabla de Costo XLSX", "Descargar Plantilla XLSX" y "Copiar tabla de costos" (cambiando la planta y los costos).
  - (I) Costo de la fórmula × tabla de costos + tarifa de servicio + margen = precio sugerido.
- **Motivo de cancelación** en la pantalla de facturación, con ícono y color por tipo de nota cancelada (C: CL-mar24).
- **Administración** > Formas de Pago, Condiciones de Pago, Tarifas e Impuestos ("Taxes") (C: GBP, FW).

### 2.18 Control de Calidad / Loop QC

**Web** (C: GBP, FW, WEB24-QC; IMG site_calidad_dashboard_reportes.png, formulas_tabla.png, formula_alertas_agua_cemento.png, tablas_formulas_archivos.png):
- **Submódulos:** Tablas de Fórmulas, Puntos de Carga, Laboratorio, Tipo de Muestra (Sample Type) y Tipo de Inspección (Inspection Type).
- **Tablas de Fórmulas** (archivos):
  - Columnas: Descripción (ej. "1‑ Santa Luzia" por planta), Nombre del archivo (.xlsx), Creado, Actualizado, Status (Activo) y Notas. Checkbox "mostrar inactivo" y "Añadir Tabla".
  - Descargas: "Descargar Archivo Original" y "Descargar Archivo Actualizado", con los cambios hechos en Loop (C: CL-mar24).
  - Se pueden tener **varios sets**, por ejemplo verano/invierno o por set de materias primas. La tabla de fórmulas se configura **por punto de carga** (C: YT-formulas).
- **Fórmulas:**
  - Lista: Código de Fórmula, Materiales, Cantidad Total, Descripción, Código y Nombre de Producto, Volumen/Ciclo, Costo Total; selector de Tabla de Costo; filtro por materia prima (C: CL-ene24). Las fórmulas se ven y se editan.
  - Editor: Descripción, **Volumen/Ciclo** (volumen de pastón; I) y líneas con Materia‑Prima, Cantidad (L o KG), **Volumen Estimado** (m³ según densidad) y Costo Unitario.
  - Pie: **Relación Agua/Cemento** (ej. 0,750) y **Volumen de hormigón** calculado (ej. 1,571 en rojo si no da ~1 m³), Cantidad Total por m³ (ej. 1.990 kg/m³). Tiene alertas (C: CL-jun24). Se puede copiar.
- **En la programación:** Tipo de inspección, regla de inspección y m³ entre inspecciones (plan de muestreo; C: IMG programacao_contrato_form.png).
- **Dashboard QC:**
  - Muestras con dona, **Test Past** (ensayos vencidos) y **Test Today**.
  - Informes: Export of Tested Samples, **Quality Certificate**, Quality Control by Customer (I), **Fresh Concrete Inspections**, Broken Samples, Broken Samples (A…), **Analyzes by Product**, **Samples to Collect**, Samples to Break.
- **Funciones declaradas** (C: WEB24-QC):
  - Trazabilidad: la muestra se asocia con la carga del batch y con el viaje, mediante QR, código de barras o n.º de remito.
  - **Plan de moldeo automático** según la frecuencia de muestreo. Los camiones a muestrear se eligen al despachar o en el momento de la extracción.
  - Reportes automáticos al cliente con formato propio.
  - Gestión centralizada de mezclas.
- Los **certificados de calidad** se descargan desde la app del cliente (C: IOS).

**App "Loop QC"** (iOS/Android, com.loop4.qcapp) (C: IOS; IMG site_app_calidad_muestras.png):
- Menú: **Inspecciones** (hormigón fresco), **Recoger** (muestras a recolectar), **Recibir** (en laboratorio) y **Ruptura** (carga del ensayo de rotura).
- "Recolectar": escanear todas las muestras. "El laboratorio requiere que todas las muestras sean escaneadas." Cada probeta tiene su número de molde y QR (00000375‑1/‑2/‑3) para **7, 14 y 28 días**. Notas y foto; botón Enviar.
- "Muestras para Recoger": lista con código de proyecto, producto, obra, dirección, **Ticket #1**, fecha, **días** (90, 75, 70, 50) y estado "En Construcción". Filtro y botón "Encontrar" por QR.
- Carga de datos de moldeo, control de muestras e inspecciones por código de barras o QR, datos de rotura y adjuntar imágenes.

**Loop Magic Slump** (video del 02/09/2026 de "GRUPO BASE"): "saber el SLUMP del hormigón dentro del camión". Es un producto nuevo, probablemente con sensor de trompo o de presión hidráulica. No tiene descripción ni transcripción (I).

### 2.19 Proyectos / Contratos (Projects)

(C: A51, CL-jun24, YT-contratos, WEB24; IMG proyectos_estados.png, cliente_contratos.png, buscar_proyecto.png)
- **Estados, con dona y contadores:** **No empezado, En proceso, Pausado, Cerrado, Propuesta, Perdido**. "Solo proyectos no empezados y en proceso pueden ser seleccionados para crear pedidos y planificaciones" (C: IMG).
- **Columnas:** Cod. Interno, Nombre, Código Cliente, Cliente, Documento 1 y Dirección. Botones **Nueva Propuesta**, **Añadir Proyecto** y Exportar.
- **Menú por fila:** Clave de App del Cliente, **Contactos del Proyecto** (vinculados a WhatsApp), **Exhibir Contrato** (documento imprimible; I), Buscar Registros del Proyecto, **Copiar Contrato** (usar un proyecto como plantilla; C: CL-jun24) y Ocurrencias. Íconos: planificar, documento, editar y borrar.
- **Contenido del proyecto** (C: YT-contratos):
  - Nombre de obra, dirección(es) y contactos.
  - **Tabla de precios propia**.
  - Hormigones y servicios habilitados para la obra: bombeo, aditivos, hielo, fibras…
  - **Adicionales parametrizados**, como "viaje incompleto" (volumen faltante) o "tiempo excesivo en obra". Cuando ocurren, se envían directo a facturación.
- **Direcciones:** varias por proyecto o cliente, para obra y para cobranza (C: A51).
- Si hay ERP, los proyectos se toman de ahí (C: YT-contratos).
- La **Propuesta/Presupuesto** nace en el CRM (C: KFvPt… funil; WEB24 "desde el prospecto a la facturación").

### 2.20 Ventas / CRM (Loop CRM, "Gestor de Lead")

(C: WEB25, WEB25-discover, HC-es; IMG site_crm_funil_ventas.png, site_crm_columnas.png)
- **"Funil de Ventas" en kanban**, con columnas personalizables: **Contacto/Lead Inicial → Primer Contacto → Presupuesto → Propuesta Enviada → …** Cada columna suma m³ y $.
- **Contadores arriba:** Leads (217), Volumen (10.199) y Presupuesto.
- **Controles:** refrescar, vista kanban o tabla, "Localizar", filtro por **Vendedor** y campana de notificaciones.
- **Tarjeta:** nombre del cliente o empresa, ciudad, "código de lead – contacto", m³, $, y los íconos de fecha/agenda, ubicación y teléfono (en naranja si falta; I). Botón de mover de etapa.
- **Ficha del lead** (sirve en celular): "Lead (124730) Creado en 20/08/2024 [vendedor]".
  - Pestañas **Obra** y **Productos & Adicionales**.
  - Contactos: nombre, teléfono, WhatsApp, editar y borrar.
  - Dirección: CEP, logradouro, dirección, número, barrio, complemento, ciudad y provincia, más un mapa con pin.
- "El único CRM diseñado para la industria del hormigón", con analítica del proceso (C: WEB25-discover).

### 2.21 Calendario
- Aparece en el menú desde v2.262 (C: IMG). No hay documentación.
- (I) Sería la vista mensual o semanal de planificaciones y pedidos.

### 2.22 Administración (catálogos)

Pantalla de íconos con favoritos (C: IMG admin_menu_cadastros.png): **Clientes, Contratos, Produtos, Vendedores, Motoristas, Finalidade, Usuários, Veículos, Plantas, Cercas Geográficas, Tarifas, Status, Forma de Pagamento, Condição de Pagamento**. En la sección **App Cliente**: **Pesquisas** (encuestas de satisfacción).

- **Clientes** (C: A19; IMG cliente_form_dados.png, cliente_form_documentos.png, cliente_limite_credito.png, cliente_endereco_mapa_geocerca.png, cliente_contratos.png):
  - Datos del Usuario: Cod. Interno, Nombre*, E‑mail, Cod. País + Teléfono y Notas.
  - Información del Usuario: Persona Física/Jurídica y **Documento 1…5** (CUIT, IIBB…).
  - **Finanzas:** "Limitar al alcanzar límite de crédito", **Límite de crédito**, **Saldo Deudor** y **Saldo Disponible**.
  - **Direcciones:** Cod. Interno, Dirección*, Número, Complemento, Barrio, Ciudad, Provincia, CP y **Huso horario**, más un mapa con búsqueda, doble clic para mover el pin y **herramienta de polígono** (geocerca de la obra; I).
  - **Contratos**: lista y "Adicionar Contrato". El sistema vincula solo.
- **Productos** (C: A39; IMG producto_*.png, materia_prima_form.png, producto_udm.png):
  - Pestañas: **Productos** (Concretos & Argamassas), **Servicios de Bomba**, **Adicionales**, **Otros Productos & Servicios**, **Taxa mínima de Bomba**, **Materias‑Primas** y **Producto UDM**.
  - **Tipos de producto:** Concreto, Bomba, Argamassa, Adicional, Matéria‑Prima, Taxa mínima de Bomba, Complemento de Bomba, Outro y Agregados. Hay un ícono para cambiar el tipo.
  - **Producto de concreto:** Cod. Interno*, Nombre*, Tipo*, Unidad de medida, **Precio Padrón**, **Slump Padrón**, **Variación Slump**, **FCK** y **Britas** (piedra), además de color y precio de tabla.
  - **Adicionales**, con pestañas Datos, **Reglas del producto** y **Plantas**:
    - "Valor a comparar*" (ej. **Volumen Faltante**; otros posibles: horas en obra, horario; I).
    - Regla: operador (==, <, >…) y valor (ej. 5).
    - Valor padrón y Tipo de valor ($ o %).
    - "Aplicar valor por unidad".
    - "Aplicar reglas a días específicos de la semana".
    - Ejemplos del artículo: horas adicionales, tasa por duración de obra, volumen mínimo y hora máxima.
  - **Materia prima:** Cod. Interno*, Nombre*, Tipo* (Arena, Cemento, Agua, Aditivo, Piedra…), Unidad* (KG, L…) y Descripción.
  - **UDM:** M3, KG, L y TN.
- **Motoristas** (C: A41; IMG motorista_form.png):
  - Campos: Cod. Interno*, Nombre*, Teléfono, **Token** (identificador del chofer para el GPS o la app; I), Documento y Dirección.
  - También se cargan los **asistentes** (ayudantes).
  - "Registros del Motorista": todas sus entregas.
  - "**Chave do Aplicativo do Motorista**": con la app, el chofer marca salida de planta, llegada a obra, salida de obra y regreso. Es útil sobre todo si **no hay GPS**.
- **Vehículos:** con GPS se sigue en tiempo real (C: A51). (I) Los campos probables son código o flota (BT340 FROTA 1910), patente, capacidad en m³, tipo (betoneira, bomba, etc.), propio o de terceros (el dashboard excluye terceros), id de GPS, planta base y estado (mantenimiento o reserva).
- **Plantas** (C: A45; IMG planta_form_geocerca.png, planta_poligono.png, planta_valores_padrao.png):
  - Datos de la Geocerca: Cod. Interno*, Nombre*, "Definir también como planta de bomba", buscador de dirección y **polígono** dibujado en el mapa.
  - **Valores Padrón** (en minutos), con botón **"Cargar del Historial"**: Tiempo de Vuelta Padrón (ej. 20), Tiempo de Ida Padrón (36), Tiempo de Carga Padrón (8) y **Tiempo de Descarga Padrón por vehículo** (60). Este último se autocompleta en las reglas de entrega de los pedidos.
  - **Puntos de Carga:** Código y Nombre (ej. LP01, EC7, P1). Los materiales se configuran después.
- **Cercas Geográficas:** geocercas de planta, obra, **prohibidas** (paradas prohibidas; C: RM21-cl-dic21) y otras.
- **Status:** Cod. interno, Nombre, color y marcas **Status Padrón / Proibido Programar / Proibido Despachar / Cancelar**. Se aplica a pedidos y programaciones y tiene log con justificación (C: A48, CL-oct23).
- **Otros catálogos:** Vendedores, Finalidad (elemento a hormigonar: columna, losa, platea…), Usuarios (ilimitados, con perfil de acceso configurable; C: WEB24-FAQ), Tarifas, Formas y Condiciones de Pago, e Impuestos (C: FW).
- **App Cliente > Encuestas:** encuesta de satisfacción desde la app del cliente (C: RM21-home, UK).

### 2.23 Ajustes / Configuraciones
- **Pestañas** (C: CL-oct23; IMG ajustes_empresa_sabado_apps.png): **Mi cuenta**, **Preferencias** (Idioma, Formato de fecha, Tema claro u oscuro) y **Configuración de la empresa**.
- **Configuración de la empresa:**
  - Dashboards: cómo contar los sábados.
  - **App Conductor**: "solo boleto" (el chofer solo ve el remito o boleta; I) y **"modo híbrido"** (marca manual en la app más GPS; I).
  - **App Cliente**: notificaciones de la app del cliente sobre el despacho.
  - Además: tolerancia de puntualidad (15 min por defecto; C: CL-ene24), alerta de tiempo en obra (C: CL-oct23), alerta de vencimiento del hormigón (C: RM21) y campos personalizados que obligan a justificar cada cambio de status (C: CL-oct23).
- **Login:** "Mantenerme conectado" (auto login) y "Cambiar contraseña" (C: CL-nov23; IMG login.png).

---

## 3. Apps móviles

| App | Plataforma / id | Funciones | Fuente |
|---|---|---|---|
| **App del cliente**, genérica: "My ReadyMix" / "Mi Hormigón" | iOS 1544144952 `readymix.360.customer`; Android `com.readymix.customer` | Agregar proyectos con la clave de 9 dígitos. Mapa en vivo de las entregas, historial, informes de tiempo en obra, pedidos futuros, **hacer pedidos desde la app**, **descargar certificados de calidad**, notificaciones push, mensajes del despachante y encuesta de satisfacción | C: IOS, GP, A2, UK |
| **Apps con marca de cada hormigonera** (≈40) | `loop4.customer.<cliente>` (Holcim, HDI, Tejamax, Hormax, Preforte, Concretos del Sol, Pavisur…) | Las mismas funciones con branding propio: colores, logo y camiones (C: WEB24). Reporte de atención (tiempo en obra y volumen por entrega) y seguimiento de cada etapa | C: IOS, GP |
| **App del chofer** (Driver App) | No es pública en las tiendas (I: se distribuye por clave) | Etapas **Chegada na Obra → Início Descarga → Fim Descarga**, con hora y "Desfazer Etapa". Muestra cliente, dirección (botón para navegar con **Waze, Google Maps o Apple Maps**), planta y punto de carga, observaciones, y **Productos y Servicios** del remito (ej. 8 m³, Bomba Estacionaria 8, asistente) con "+" para agregar. Botones "Cheguei na Obra" y "Continuar". POD (prueba de entrega) | C: IMG site_app_chofer_etapas.png, A41, UK, RM21 |
| **Loop Digital Ticket** (E‑Ticket) | iOS 6670759877 `loop4.app.digitalticket`; Android `com.loop.digitalticket` | **Remito digital**: juntar los datos de la entrega y **firmar el remito en el dispositivo** en obra, sin papel | C: IOS, GP, WEB25-discover |
| **Loop QC** | iOS 6474789376; Android `com.loop4.qcapp` | Ver la sección 2.18 | C: IOS |
| **Loop Fuel** | No se encontró en las tiendas (I: privada o dentro de otra app) | Ver la sección 2.15 | C: IMG |
| **App de gestión "ReadyMix 360 APP"** para el dueño o gerente, y **app del bombista** | Mencionadas en los planes 2021 | Panel de operaciones y KPIs en el celular | C: RM21-home, IMG site_app_cliente_mockups.png |

**Mensajes de WhatsApp** (C: IMG site_whatsapp_mensajes.png):
- "…su pedido/remito ya fue despachado y está próximo a llegar a destino", con cantidad, producto y camión.
- Invita a descargar la app con el código 000‑000‑000. Botón "Contactarse". Pie "powered by loop4.io".
- Se configura un mensaje por etapa (C: WEB25).

---

## 4. Modelo de datos inferido

Entidades con sus atributos principales. Casi todo es (I), armado desde formularios y columnas vistos en las capturas, que son confirmados.

- **Empresa (tenant):**
  - Configuración: sábados, apps, tolerancias, idioma, formato y tema.
  - Varias **Plantas**.
- **Planta:** código, nombre, geocerca (polígono), si también es planta de bomba, tiempos estándar (ida, vuelta, carga, descarga por vehículo, cargables desde el historial) y husos. Tiene **Puntos de Carga**.
- **PuntoDeCarga:** código y nombre. Tiene asignada una TablaDeFórmulas activa.
- **TablaDeFórmulas:** descripción, archivo xlsx original y actualizado, estado, notas, planta o punto de carga, y set (verano, invierno, etc.).
- **Fórmula:** código, descripción, producto, volumen/ciclo, y **líneas** (materia prima, cantidad, unidad, volumen estimado, costo). Calcula relación a/c, volumen y costo total.
- **MateriaPrima:** código, nombre, tipo, unidad y densidad (I).
- **TablaDeCosto:** código, nombre, planta, tarifa de servicio, margen %, y líneas (materia prima, costo).
- **Producto:** código, nombre, tipo, UDM, precio padrón, color, slump padrón y variación, FCK y piedra.
  - Subtipos: servicio de bomba (valor $ o %), adicional (reglas: variable a comparar, operador, valor, por unidad, días de la semana, plantas), otro producto o servicio, tarifa mínima de bomba y complemento de bomba.
- **Cliente:** código, nombre, email, teléfono, notas, persona física o jurídica, documentos 1..5, límite de crédito y bloqueo, saldo deudor y disponible. Tiene **Direcciones** y **Proyectos**.
- **Dirección / Obra:** código, calle, número, complemento, barrio, ciudad, provincia, CP, huso horario, lat/long y geocerca (polígono).
- **Proyecto / Contrato:** código, nombre, cliente, documento, direcciones, contactos (con WhatsApp), vendedor, estado (no empezado, en proceso, pausado, cerrado, propuesta o perdido), **tabla de precios / precios por producto**, productos habilitados, adicionales, **clave de la app del cliente** (9 dígitos, reseteable), registros y ocurrencias.
- **Lead / Oportunidad (CRM):** id, fecha, vendedor, etapa del embudo, contactos, obra y dirección, productos y adicionales, m³ y $ presupuestados. Se convierte en Proyecto.
- **OrdenDeCompra:** número, proyecto, dirección, cantidad total, fecha de entrega, creación, notas, estado (activa o anulada) e historial.
- **Pedido:** número, tipo, clasificación, planta, cliente, proyecto, dirección, vendedor, fecha y hora de entrega, OC, finalidad, status, observaciones del cliente e internas, "mostrar precio en la entrega", y líneas de producto (concreto: m³ y precio; bomba: cantidad, precio, cantidad mínima y precio mínimo; otros). Tiene historial de status.
- **Programación / Planificación:** pedido o proyecto, planta, fecha, producto, volumen total, bomba, otros productos, reglas de entrega (llegada a obra, inicio de carga, tiempo efectivo de carga, puntos de carga, tiempo de ida, descarga por m³ o por camión, volumen máximo por viaje, frecuencia), QC (tipo de inspección, regla, m³ entre inspecciones), status, confirmada, suspendida, finalizada, cancelada, color, notas de servicio, mensajes, ocurrencias, justificación de retraso y log de aprobaciones.
- **Ticket (planificado):** programación, secuencia n/N, m³, y horarios planificados de inicio de carga, salida, llegada a obra, fin de descarga y regreso.
- **Entrega / Remito (despachado):** código de entrega, n.º de entrega, n.º de remito, ticket, vehículo, chofer, asistentes, punto de carga, fecha y hora de inicio, precinto, volumen previo en el trompo, productos y cantidades con precio, status (vigente o cancelado, con motivo), verificación en el cierre (pendiente, verificada o rechazada), n.º de factura y registros de edición.
- **Viaje (GPS):** entrega (o ninguna: viaje sin remito), tipo (regular, cambio de planta o error), hitos (inicio de carga, salida, llegada a obra, inicio y fin de descarga, salida de obra, llegada a planta), km de ida y de vuelta, paradas (con flag de prohibida o fuera de obra), puntos GPS y series de sensores (velocidad, altitud, trompo, agua, rotación). Tiene estado de auditoría.
- **Carga Batch:** código interno, punto de carga, inicio, volumen, producto, y materiales teóricos contra reales. Se vincula con la entrega.
- **Vehículo:** código o flota, patente, tipo, capacidad (I), propio o de terceros, id de GPS, planta y estado (disponible, mantenimiento, reserva).
- **Chofer / Asistente:** código, nombre, teléfono, token, documento, dirección y clave de app.
- **Bomba:** vehículo de tipo bomba. Tiene sus propias asignaciones (Gantt) por pedido.
- **Status** (catálogo): código, nombre, color y las marcas default / proibido programar / proibido despachar / cancela.
- **Ocurrencia:** origen (usuario o sistema), fecha, tipo (ej. inserción manual, retraso), detalle, descripción, motivo y leído.
- **Muestra / Inspección (QC):** entrega o ticket, tipo de muestra, número de molde y QR, edades (7, 14, 28 días), estado (a recolectar, recolectada, recibida, ensayada), resultado de rotura, fotos, e inspección de hormigón fresco (slump, temperatura; I).
- **Cargas de combustible:** tanque (recepciones), surtidor (aperturas y cierres), vehículo (litros, odómetro, horómetro, fotos, fecha y carga previa).
- **Usuario:** perfil de accesos, niveles de autorización y bloqueos (C: WEB24).
- **Vendedor, Finalidad, Tarifa, Impuesto, Forma de pago, Condición de pago, Encuesta.**

---

## 5. Ciclo de vida de una venta: del lead a la factura

1. **Lead** en el CRM: contacto y obra; presupuesto (m³ y $); propuesta enviada. Etapas personalizables (C: IMG CRM).
2. **Propuesta → Proyecto/Contrato**: botón "Nueva Propuesta" y estado "Propuesta"; se gana y pasa a "No empezado / En proceso", o se pierde y queda "Perdido" (C: IMG proyectos_estados.png).
   - Se definen precios, productos y adicionales, y se generan la **clave de app** y los **contactos**.
   - Si hay ERP, el proyecto se importa (C: YT-contratos).
3. **Orden de compra** del cliente, opcional (C: CL-ene24).
4. **Pedido**: fecha y hora, planta, productos y bomba, status. Si el status tiene "proibido programar" (por ejemplo, un bloqueo financiero), se detiene. "Salvar e Programar" (C: GBP, A48).
5. **Planificación**: reglas de entrega, sugerencia de horario sin conflicto, gráfico de demanda contra capacidad, gráfico de bomba y reservas (C: CL-dic23, YT-programar).
6. **Confirmación** con el cliente (👍 "Confirmar programación") (C: A2).
7. **Tickets** generados, ajustables en el Gerenciador (C: A2).
8. **Despacho**: arrastrar al mixer, se crea el remito, se imprime, se envía la línea al batch, arranca el GPS, se avisa al cliente por la app y por WhatsApp, y la información va al ERP (C: YT-despacho).
   - Controles: status "proibido despachar", límite de crédito y precios divergentes.
   - QC: el plan de muestreo marca qué camión se muestrea (C: WEB24-QC).
9. **Ejecución**: el panel sigue carga → ida → obra → descarga → vuelta, con alertas de retraso, paradas y tiempo en obra. El chofer usa su app o el GPS, y opcionalmente firma el remito digital (C: YT-panel, IOS).
10. **Incidencias**: suspender (lluvia), reabrir, ajustar tickets, agregar tickets faltantes o quitar excedentes, justificar retrasos y registrar ocurrencias (C: A2, CL-ene24).
11. **Finalizar programación** (C: A2).
12. **Auditoría de entregas y de cargas**: GPS contra remito, batch contra remito (C: YT-auditoria).
13. **Cierre del día**: verificar cada remito, **procesar adicionales** (volumen faltante, tiempo excesivo en obra, horas extra, tarifa mínima de bomba…), confirmar remesas pendientes, cerrar o bloquear el día (C: A2, IMG).
14. **Facturación**: elegir líneas, "Generar Facturación", asignar n.º de factura, exportar o integrar al ERP (C: CL-mar24, YT-finanzas).
15. **Post-venta**: informes (Notas de hormigón, facturación por cliente), certificados QC en la app, encuesta de satisfacción (C: IOS, RM21).

---

## 6. Integraciones

- **GPS:** "se integra con su GPS", con cualquier proveedor que ofrezca un medio de integración (C: WEB24-FAQ). En 2021 figuraba "Integration with GPS tracking providers" en todos los planes (C: RM21-home).
  - El revendedor UK (Fleetware / Switch Systems, en Irlanda del Norte) usa una plataforma tipo Wialon, "Pulse GPS" (C: FW).
  - Subdominios `gps.readymix.io` y `track.readymix.io` (C: CDX).
  - Los tiempos por defecto de la planta se **aprenden del historial GPS** ("Cargar del Historial"; C: IMG).
  - La app del chofer reemplaza al GPS donde no lo hay (C: A41). "App Conductor modo híbrido" (C: IMG).
  - Hay integración de sensores de trompo: rotación, agua y un "sensor de globo" (C: IMG). También "Magic Slump" (2026).
- **Sistema de batch / automatización de planta:**
  - Al despachar se envía la "línea de despacho" con los materiales de la fórmula a cargar (C: YT-despacho, YT-formulas).
  - Se leen las cargas reales para la auditoría de carga: sin entrega, sin carga, diferencia de volumen, desviación, materiales faltantes o excedentes, cargas manuales (C: YT-auditoria, WEB24).
  - Changelog de 2021: "Broker en la pantalla de despacho: al recibir un ticket, intenta vincularlo con los pedidos" (C: RM21-changelog). Es decir, si el ticket nace en el batch, Loop lo empareja con el pedido.
- **ERP / sistema de administración:**
  - Pedidos y proyectos desde el ERP; se le envía la información administrativa y de facturación (C: YT-despacho, YT-contratos, YT-finanzas, RM21-planning).
  - Las pantallas de auditoría rotulan la columna como "DATOS ERP / ENTREGAS" (C: IMG).
- **Otras integraciones:** reloj o control de ingreso de personal y sistema de tanques de combustible (C: WEB24-FAQ).
- **Importación y exportación:** XLS/XLSX (fórmulas, tabla de costos, plan "XLS files import") y exportación a Excel de casi todas las tablas (C: RM21-home, CL-mar24).
- **API:** "API Integration" en los planes Advanced y Enterprise (C: RM21-home). Hay subdominio `integration.readymix.io` (C: CDX). No hay documentación pública.
- **Notificaciones:** WhatsApp automático por etapa, SMS y push de la app (C: WEB25, WEB24).
  - (I) Push por OneSignal, visible en los marcadores del navegador del equipo Loop (C: IMG despacho_tooltip_programacion_url.png).
- **Stack visible** (I, por subdominios y marcadores): web SPA en `app.loop4.io` (antes `360.readymix.io`, PWA "Loop 4 Readymix"), reportes con jsreport, `plan.readymix.io`, `log.readymix.io` (login "Logistic"), AWS, Bitbucket, Jira, Intercom y luego Gleap, mapas Leaflet y Google.
- **Soporte:** help desk en línea, AnyDesk para soporte remoto, tutoriales en video y en texto (C: WEB24-FAQ, HC).

---

## 7. KPIs, definiciones y valores de referencia

| KPI | Definición en Loop | Valores de referencia | Fuente |
|---|---|---|---|
| **Ciclo de entrega** | Desde que empieza la carga (o se crea el ticket) hasta que el camión vuelve a planta = carga + ida + obra + vuelta. Ejemplo: 20 + 40 + 60 + 40 = 160 min | Rango de 30 a 180 min. Dashboard: benchmark **151**, Top 5 **150**. Un cliente: 137 prom., 124 hoy | C: BLOG-ciclo, IMG dashboard_logistica_benchmark.png |
| **Tiempo de carga** | Desde la creación del ticket hasta que el camión sale de planta. Incluye pesaje y carga, inspección visual y limpieza, y espera | Normal 10–25 min, meta < 20. Benchmark **32**, Top 5 **24** | C: BLOG-ciclo, IMG |
| **Tiempo en ruta** (ida + vuelta) | Tiempo manejando a la obra y de vuelta. Lo afectan la distancia, el tráfico, el tipo de camino, los desvíos y las paradas no autorizadas | 30–120 min. Benchmark **63**, Top 5 **59** | C: BLOG-ciclo, IMG |
| **Tiempo en obra** | Todo el tiempo dentro de la geocerca de la obra: espera, slump, descarga, lavado | Benchmark **71**, Top 5 **69**. Alerta configurable, ej. > 90 min | C: BLOG-ciclo, IMG, CL-oct23 |
| **Ralenti en planta por viaje** | Suma del tiempo con motor encendido y sin movimiento dentro de la planta (carga, espera, ajuste de asentamiento, lavado, calentamiento o climatización), dividida por la cantidad de viajes | Buena práctica ~**35 min**. Primera medición típica ~60 (hasta 95). Ideal ≤ 30 min (2021). Benchmark **46,5**, Top 5 **37,5**. 10 min de ralenti ≈ 1 L de gasoil + 1 L equivalente en mantenimiento. Ahorro de USD 3,5 a 15 por viaje. Mejora de 15–30 min en una semana | C: BLOG-ralenti, BLOG-ocio, IMG dashboard_ralenti_benchmark.png |
| **Ralenti en obra** | Motor encendido en obra | Aceptable 25–40 min, excepcionalmente hasta 2 h | C: RM-sust |
| **Volumen por remito** (m³/viaje) | m³ entregados / remitos | Ejemplo: 7 prom., 6,9 hoy | C: IMG dashboard_eficiencia_benchmark.png |
| **Volumen por conductor** (m³/día) | m³ / choferes | Benchmark **16,7**, Top 5 **19,9**. Ejemplo: 22,2 prom. | C: IMG |
| **Minutos por m³** | Minutos de ciclo o de operación por m³ entregado | Benchmark **20,4**, Top 5 **17,5**. Ejemplo: 16,2 | C: IMG |
| **Viajes por camión / día** y **m³ por camión / mes** | Productividad de la flota | Clientes que pasaron de 370 a 600 m³/mes por camión. Ejemplo de informe: 230–360 m³/mes | C: WEB25, IMG informe_volumen_por_camion.png |
| **Puntualidad** (por cliente o programación) | Llegada del primer camión (y de cada camión) contra la hora programada | Tolerancia de **15 min** por defecto, configurable. Con Loop, "más del doble de puntualidad"; +26% entregas a tiempo; −30 min por hora en llegada a obra | C: CL-ene24, WEB24, RM21-home |
| **Entregas / vehículo**, **Volumen / vehículo**, **Ciclo promedio** | En el resumen de pedidos y en la planificación | Ejemplo: 3,5 entregas y 22,5 m³ por vehículo | C: IMG |
| **Paradas extra**, % de viajes con parada extra, velocidad media | En la auditoría y en el blog | — | C: BLOG-ciclo |
| **Dif. Dist.** | Diferencia de km entre ida y vuelta, para detectar desvíos | — | C: CL-oct23 |
| **Remitos, volumen, clientes por día** | Pestaña Producción | Ejemplo mensual: 14.230 remitos, 99.191 m³, 1.936 clientes | C: IMG dashboard_produccion.png |
| **Combustible por m³** | L por m³ despachado | Mejora de −0,25 L/m³; +5% de ahorro de combustible | C: WEB25, RM21 |
| **Resultados comerciales declarados** | — | +27,5% producción por camión; +23% eficiencia del chofer; 0 errores de programación; −20 horas-hombre por mes; menos horas extra; −USD 4 por viaje en ralenti; hasta −25% en costos operativos | C: WEB25, YT-institucional |

---

## 8. Capturas descargadas más útiles, por módulo

Todas están en `capturas-loop/`.

- **Despacho:** `despacho_pantalla_principal.jpg` (menú completo 2023), `site_despacho_web.jpg`, `despacho_form_entrega.jpg`, `despacho_filtro_betoneiras.jpg`, `despacho_betoneiras_de_planta.jpg`, `despacho_menu_programacion.jpg`, `despacho_menu_planificacion_v2288.jpg`, `despacho_confirmar_programacion.jpg`, `despacho_chave_app_cliente.jpg`, `despacho_suspender_programacion.jpg`, `despacho_enviar_mensaje.jpg`, `despacho_planificaciones_canceladas.jpg`, `despacho_icono_puntualidad.jpg`, `despacho_tooltip_programacion_url.jpg`, `despacho_ver_todas_entregas.jpg`, `ocorrencias.jpg`.
- **Gerenciador de tickets:** `gerenciador_tickets_gantt.jpg`.
- **Entregas y viaje:** `entregas_tabla.jpg`, `entregas_iconos_retraso.jpg`, `entrega_registros_edicion.jpg`, `entrega_mapa_ruta.jpg`, `viaje_grafico_velocidad_sensores.jpg`.
- **Pedidos:** `pedidos_lista_semana.jpg`, `pedidos_columnas.jpg`, `pedidos_resumen_grafico_demanda.jpg`, `pedido_form_nuevo.jpg`, `pedido_programaciones.jpg`, `site_pedidos_lista.jpg`, `site_resumen_pedidos_grafico_demanda.jpg`.
- **Planificación:** `site_programaciones_planned_orders.jpg`, `planificaciones_planta_menu.jpg`, `planificaciones_resumen_duplicar.jpg`, `planificacion_otros_productos.jpg`, `planificacion_cambiar_status.jpg`, `programacao_contrato_form.jpg`, `reglas_entrega_sugerencia_llegada.jpg`, `buscar_proyecto.jpg`, `precios_divergentes.jpg`, `ordenes_compra.jpg`.
- **Bomba:** `bomba_programacion_gantt.jpg`.
- **Panel de control:** `site_panel_operaciones_web.jpg`, `site_panel_operaciones_timeline.jpg`.
- **Auditorías:** `site_auditoria_entregas.jpg`, `auditoria_entregas_columnas.jpg`, `auditoria_carga_batch.jpg`, `site_auditoria_cargas_erp.jpg`.
- **Dashboard y análisis:** `dashboard_eficiencia_benchmark.jpg`, `dashboard_produccion.jpg`, `dashboard_logistica_benchmark.jpg`, `dashboard_ralenti_benchmark.jpg`, `dashboard_conductores_ralenti.jpg`, `site_dashboard_benchmark_carga.jpg`, `analisis_datos_filtros.jpg`.
- **Informes:** `informes_produccion_es.jpg`, `reports_production_en.jpg`, `informes_planificacion.jpg`, `informes_financieros.jpg`, `informes_ventas.jpg`, `informe_volumen_por_camion.jpg`, `informe_notas_hormigon.jpg`.
- **Finanzas:** `fechamento_do_dia.jpg`, `site_cierre_del_dia.jpg`, `facturacion_por_proyecto.jpg`, `vendas_notas_form.jpg`, `tabla_costo.jpg`.
- **Calidad y fórmulas:** `site_calidad_dashboard_reportes.jpg`, `site_app_calidad_muestras.jpg`, `formulas_tabla.jpg`, `formula_alertas_agua_cemento.jpg`, `tablas_formulas_archivos.jpg`.
- **Proyectos y CRM:** `proyectos_estados.jpg`, `site_crm_funil_ventas.jpg`, `site_crm_columnas.jpg`.
- **Combustible:** `site_combustible_web.jpg`, `site_app_combustible.jpg`.
- **Apps y notificaciones:** `site_app_chofer_etapas.jpg`, `site_despacho_y_app_cliente.jpg`, `site_app_cliente_mockups.jpg`, `site_whatsapp_mensajes.jpg`.
- **Administración:** `admin_menu_cadastros.jpg`, `cliente_form_dados.jpg`, `cliente_form_documentos.jpg`, `cliente_limite_credito.jpg`, `cliente_endereco_mapa_geocerca.jpg`, `cliente_contratos.jpg`, `producto_concreto_form.jpg`, `producto_tipos.jpg`, `producto_servicio_bomba.jpg`, `producto_adicional_reglas.jpg`, `materia_prima_form.jpg`, `producto_udm.jpg`, `motorista_form.jpg`, `planta_form_geocerca.jpg`, `planta_poligono.jpg`, `planta_valores_padrao.jpg`, `ajustes_empresa_sabado_apps.jpg`, `login.jpg`.
- **Originales:** `desp_*.png`, `cli_*`, `prod_*`, `mot_*`, `cl_<artículo>_<n>.png` (changelogs), `pedidos_*.png`; en `site/` están las imágenes del sitio actual, y en `site/svgr/` los SVG convertidos a PNG.

---

## 9. Lo que sigue sin saberse

- **Textos completos de artículos no archivados.** Programación (id 1), Contratos/Proyectos (18), Vehículos (44), Pedidos (existe el GitBook PT), Painel, Mapa, Auditoría, Bomba (8), Finanzas (33 Day closings y otros), QC, Integrations, Ajustes, Gestor de Lead, Análisis de combustible y los changelogs posteriores a junio de 2024.
  - `docs.loop4.io` sigue fallando por SSL, Wayback no tiene esas páginas y el GitBook `docs.loop4.com.br` hoy da 404.
  - Se descartó usar la clave del widget Gleap para consultar su API, porque es un token.
- **Fórmula exacta del escalonamiento de tickets.** No se sabe si se usa la descarga por m³ o por camión, ni cómo entran la frecuencia y la cantidad de puntos de carga. Tampoco qué significa exactamente el campo "… por m³ = 8" y cómo se llega al "Tiempo total 64 min".
- **Significado exacto de los 7 contadores del Despacho**: solo está confirmado "Volumen cancelado". Tampoco se sabe qué muestran los contadores del panel de operaciones.
- **Formato y protocolo de integración** con batch, GPS y ERP, y la API pública, si existe.
- **Campos exactos de Vehículo, Geocerca, Tarifas, Impuestos, Usuarios y perfiles de permiso**, y de Vendedores y Finalidad.
- **Detalle de la App del Chofer**: pantallas previas a "Chegada na Obra", login con clave, POD con firma o foto, y el significado de "modo solo boleto".
- **Loop Fuel**: fórmula de L/m³ y alertas. **Magic Slump**: cómo funciona.
- **Calendario, Auditoría de vendedores, Informes de conductores y de cargas**: contenido no documentado.
- **Reglas de cálculo de los adicionales** más allá de "Volumen faltante ==/</> valor": tiempo excesivo en obra, horario nocturno, fin de semana.
- **Precios actuales** (2025–2026) del producto principal.

---

## 10. Qué conviene copiar para Rebucret (breve, I)

1. **Ticket como unidad**, con Gerenciador en Gantt (carga, ida, descarga, vuelta) y los botones "ajustar a la hora actual / agregar faltantes / quitar excedentes".
2. **Despacho en 3 columnas** con arrastrar y soltar. Estados del mixer: en planta, en viaje, mantenimiento, sin chofer, reserva. Borde rojo para tickets atrasados y amarillo para los cancelados.
3. **Valores estándar por planta** (ida, vuelta, carga, descarga) que se aprenden del GPS, y **sugerencia de hora de llegada** que evita choques en el punto de carga.
4. **Status configurables** con las marcas proibido programar / proibido despachar / cancela, justificación obligatoria y log.
5. **Proyecto = contrato + obra**, con precios y adicionales propios. Los adicionales tienen reglas (volumen faltante, tiempo en obra) y se procesan en el **Cierre del día** antes de facturar.
6. **Panel de control** con línea de tiempo por viaje y cronómetro del tramo en curso. **Auditoría de entregas** (GPS contra remito) y **de cargas** (batch contra remito).
7. **Dashboard** con Eficiencia, Producción, Logística y Ralenti, y metas de referencia: ciclo ~150, carga < 20–25, ruta ~60, obra ~70, ralenti ≤ 35 min por viaje, puntualidad con tolerancia de 15 min.
8. **Clave de app o link por proyecto** para el cliente, y **WhatsApp automático** cuando se despacha.

---

## 11. Fuentes (con timestamps de Wayback)

**Centro de ayuda docs.loop4.io (Gleap)**, vía `https://web.archive.org/web/<ts>id_/<url>`:
- A2: https://docs.loop4.io/pt/articles/2-despacho, ts 20240309094420 (más el Loom embebido df5214dc1ecf40549e79c57bb9877d6c).
- A51: …/pt/articles/51-inicio-rapido, 20240306200621.
- A45: …/pt/articles/45-cadastro-de-plantas, 20240309094408.
- A48: …/pt/articles/48-cadastro-de-status, 20240309094407.
- A19: …/pt/articles/19-cadastro-de-clientes, 20240309094414.
- A39: …/pt/articles/39-cadastro-de-produtos, 20240309094419.
- A41: …/pt/articles/41-cadastro-de-motoristas, 20240309094415.
- A94: …/es/articles/94-otros-productos-y-servicios, 20250115190528.
- Changelogs:
  - CL-oct23: …/es/articles/61-octubre-2023, 20240804215159.
  - CL-nov23: …/92-noviembre-2023, 20240804200954.
  - CL-dic23: …/95-diciembre-2023, 20240804205724.
  - CL-ene24: …/98-enero-2024, 20240804214740.
  - CL-feb24: …/105-febrero-2024, 20240804210527.
  - CL-mar24: …/111-marzo-2024, 20240804202828.
  - CL-jun24: …/115-junio-2024, 20240804203647.
- HC (portadas y colecciones):
  - …/pt, 20240309094408.
  - …/es, 20240804214514.
  - …/pt?_rsc=1ozoh, 20240306200625.
  - …/es/collections/25-changelogs, 20240529125430.
  - …/pt/collections/21-inicio-rapido, 20240309094416.
- Redirecciones vistas: 1-programa-o → 1-programacao (20240309094412); 44-cadastro-de-ve-culos (20240309094417). Ninguna de las dos tiene contenido archivado.

**GitBook:**
- GBP: https://docs.loop4.com.br/docs-pt (página "Pedidos" con el índice completo), ts 20241218141539.
- Imágenes: files.gitbook.com, space EBrLBhXws64EjHOiK68k (siguen accesibles).

**Revendedor UK (Fleetware):**
- FW: https://fleetware.zohodesk.com/portal/en/kb/support/loop-4-readymix (en vivo, 29/09/2026). Los artículos embeben iframes docs.loop4.io/en/articles/8-pump-planning, 33-day-delivery-closings, etc.

**Sitios comerciales:**
- WEB25: https://www.loop4.io/ , /es , /pt , /discover-loop4 (en vivo, 29/09/2026; Framer; imágenes en framerusercontent.com).
- WEB24: https://www.loop4.io/ar/home/ (20240529150916).
- WEB24-QC: https://www.loop4.io/ar/landing-loop-qc/ (20240805221633).
- WEB24-FAQ: https://loop4.io/ar/preguntas-frecuentes/ (20240519075104) y /por/preguntas-frecuentes-3/ (20240613061101).
- BLOG-ciclo: loop4.io/2024/04/04/the-importance-of-the-delivery-cycle-… (20240519074942).
- BLOG-ocio: …/are-you-controlling-idleness-… (20240519075538).
- BLOG-puntual: …/the-importance-of-on-time-deliveries-… (20240519081332).
- BLOG-ralenti: loop4.io/2024/07/02/ralenti-en-planta-por-viaje/ (20240714140253).
- BLOG-HDI: loop4.io/ar/2024/06/24/participamos-con-nuestra-disertacion-… (20240714143500).
- RM-sust: loop4.io/ar/2024/03/25/sustainability-… (20240519071948).
- RM21 (Readymix360):
  - Home: https://www.readymix.io/ (20210322044324).
  - /kpi (20210928193327).
  - /planning (20210928205141).
  - /changelog (20210928195944).
  - /post/changelog-november-2021 (20211204165818).
  - /post/changelog-december-2021-december (20220117104811).
  - /about (20210413035109).
- RM-report: report.readymix.io (20240913022519; jsreport).
- log.readymix.io (20240510231631).
- plan.readymix.io/manifest.json (20250128165138).
- UK: https://loop4readymix.co.uk/index.php/features/ (20220703143619).

**YouTube** (canal @loop4readymix; transcripciones automáticas leídas en el navegador):
- YT-programar: W6pHSMQaB_M.
- YT-despacho: j9ul0BE5yEY.
- YT-auditoria: wci7uFm7bmE.
- YT-finanzas: vJrrIzDPujY.
- YT-informes: mE8Pjj1sDv8.
- YT-formulas: C4SrMHrQ_0s.
- YT-contratos: ZnmjCMK7Bpw.
- YT-panel: G93ghGAR_sw.
- YT-institucional: KbiSjzK0KIo / dIi1bk3mgHA / jO41xwkrIiU.
- Testimonios "LOOP TV – AAHE": 5Wc7BnqbDME.
- Magic Slump: ZRPylcv3Poo (sin transcripción).
- Presentación de Readymix360: __ECmFN0ZZg (Walney Seixas).

**Tiendas:**
- IOS: iTunes Search API, desarrollador "Loop 4 Solutions Ltda ME". Apps: My ReadyMix 1544144952, Loop QC 6474789376, Loop Digital Ticket 6670759877, y ~40 apps de marca de cliente.
- GP: https://play.google.com/store/apps/developer?id=Loop+4+Readymix (29/09/2026).

**Fuentes no disponibles:** docs.loop4.io en vivo (error SSL), archive.ph (sin capturas) y la transcripción de Loom (pide registro).
