# Zomatik · revisión de vínculos (para confirmar)

Generado el 21/10/2026, 10:52:54 con la copia de Zomatik recién leída y la base de producción (solo lectura). **Nada de esta lista está grabado.** Ya hay vínculos que Bautista confirmó a mano en la pantalla (no aparecen acá y no se tocan). Los seguros de la primera carga (punto 0) todavía no se grabaron: la corrida con `--commit` quedó frenada por un permiso.

Cómo se calcula la confianza: además del nombre, se cruzan los **días y m³ despachados en Rebucret** (desde el 13/04/2026, cuando arrancaron nuestros despachos) con los **remitos de Zomatik** del mismo cliente, en la misma planta (Canning = depósito 116, Hudson = REBUCRET 113), con una ventana de 3 días antes a 1 después (Zomatik a veces remite atrasado y junta días) y sumando los m³.

- **Alta:** 2 o más días en común, en la misma planta, con los m³ parecidos, y cubre la mayoría de nuestros días. Se puede grabar de una.
- **Media:** el nombre se parece o coinciden algunos días. Mirarlo.
- **Baja:** poca o ninguna evidencia, o la evidencia contradice el nombre. Decidir a mano.

| | Alta | Media | Baja | Sin propuesta |
|---|---|---|---|---|
| Seguros sin grabar | clientes 1 | fórmulas 25 | | |
| Clientes (57 dudosos o sin par) | 4 | 19 | 20 | 14 |
| Fórmulas (38 dudosas o sin par) | 3 | 27 | 1 | 7 |
| Proyectos abiertos (33 sin obra) | 4 | 7 | 12 | 10 |

## 0. Seguros (todavía sin grabar)

Son los que la primera carga graba solos (nombre igual sin tildes ni S.A., o con las reglas de fórmulas). **La grabación con `--commit` quedó frenada por un permiso: falta el OK para correrla.** Abajo, con la evidencia de fechas y m³ de cada uno.

| Nuestro | Despachos | Zomatik | Confianza por evidencia | Evidencia |
|---|---|---|---|---|
| Luciano | 2 | LUCIANO ARQ (20959) | media | 1 día en común de 1 de Zomatik (y de 1 nuestros), 100 % de los m³ (7.5 contra 7.5), misma planta |

Fórmulas seguras (25): Canning: H25-620-15 B (CAN) → H25-620-15 B (CAN) · Canning: H30-620-10 C (CAN) → H30-620-10 C (CAN) · Canning: H30-620-15 B (CAN) → H30-620-15 B (CAN) · Canning: H30-612-10 C (CAN) → H30-612-10 C (CAN) · Canning: H30-612-15 B (CAN) → H30-612-15 B (CAN) · Canning: H40-620-10 C (CAN) → H40-620-10 C (CAN) · Canning: H40-620-15 B (CAN) → H40-620-15 B (CAN) · Canning: H30-GUN (CAN) → H30-GUNITADO (CAN) · Hudson: H40-620-15 B → H40-620-15 B (HUD) · Hudson: H8-620-10 C → H8-620-10 C (HUD) · Canning: H21-620-15 B (CAN) → H21-620-15 B (CAN) · Hudson: H13-620-10 C → H13-620-10 C (HUD) · Hudson: H17-620-10 C → H17-620-10 C (HUD) · Hudson: H21-612-15 B → H21-612-15 B (HUD) · Hudson: H21-620-10 C → H21-620-10 C (HUD) · Hudson: H25-620-15 B PELQUE → H25-620-15 B (HUD) PELQUE · Hudson: H21-620-15 B → H21-620-15 B (HUD) · Hudson: H35-620-15 B → H35-620-15 B (HUD) · Hudson: H35-620-10 C → H35-620-10 C (HUD) · Hudson: H17-620-15 B → H17-620-15 B (HUD) · Hudson: H25-620-15 B → H25-620-15 B (HUD) · Hudson: H30-620-10 C → H30-620-10 C (HUD) · Hudson: H30-620-15 B → H30-620-15 B (HUD) · Hudson: H30-GUN → H30-GUNITADO (HUD) · Hudson: H35-6/12-15 B → H35-612-15 B (HUD)

## 1. Clientes (dudosos y sin par por nombre)

| Nuestro | Despachos | Propuesta Zomatik | Confianza | Motivo |
|---|---|---|---|---|
| MERVA SA | 46 | MERVA S.A. (24644) | alta | Nombre igual, pero hay otro cliente nuestro igual; 10 días en común de 19 de Zomatik (y de 11 nuestros), 97 % de los m³ (353 contra 343), 3 días solo en la otra planta |
| MATIAS | 15 | MATIAS ECHEVERRY (23350) | alta | Nombre parecido; 4 días en común de 9 de Zomatik (y de 5 nuestros), 100 % de los m³ (98.5 contra 98.5), misma planta |
| PATRICIO | 12 | PATRICIO ELCANO (23151) | alta | Nombre parecido; 4 días en común de 7 de Zomatik (y de 4 nuestros), 100 % de los m³ (63 contra 63), 1 día solo en la otra planta |
| Angel | 4 | ANGEL CONSTRUCTOR PISOS (23279) | alta | Nombre parecido; 4 días en común de 4 de Zomatik (y de 4 nuestros), 100 % de los m³ (16 contra 16), misma planta |
| TOP | 23 | TAPA TOP SRL (24989) | media | Nombre parecido; 1 día en común de 1 de Zomatik (y de 1 nuestros), 90 % de los m³ (63 contra 70), misma planta |
| LUSNICH MATIAS DANIEL | 19 | MATIAS DANIEL LUSNICH (24800) | media | CUIT igual, pero hay otro cliente nuestro igual; 1 día en común de 2 de Zomatik (y de 1 nuestros), 100 % de los m³ (55 contra 55), misma planta |
| SANTA CLARA | 15 | mariano santa clara lote 315 (24950) | media | nombre parecido; 1 día en común de 1 de Zomatik (y de 3 nuestros), 100 % de los m³ (14 contra 14), misma planta |
| FIDEL - Lanus | 10 | FIDEL (20980) | media | Nombre parecido; 3 días en común de 4 de Zomatik (y de 3 nuestros), 67 % de los m³ (45 contra 67), misma planta |
| OKIOS | 9 | OIKOS CONSTRUCCIONES (24808) | media | nombre distinto; 3 días en común de 6 de Zomatik (y de 3 nuestros), 100 % de los m³ (39 contra 39), misma planta |
| SANTA RITA | 6 | FIDEICOMISO DE ADMINISTRACION CONSORCIAL SANTA RITA (24985) | media | Nombre parecido; sin remitos en Zomatik desde abril (acá 3 días con despachos) |
| Santa Clara L645 | 4 | Gonzalo Burgos Santa Clara (24713) | media | nombre parecido; 1 día en común de 2 de Zomatik (y de 1 nuestros), 100 % de los m³ (12 contra 12), misma planta |
| Paisa | 4 | SOLDADO PAISA (22815) | media | Nombre parecido; 1 día en común de 5 de Zomatik (y de 2 nuestros), 100 % de los m³ (18.5 contra 18.5), misma planta |
| LAS VICTORIAS | 3 | LEANDRO LAS VICTORIAS (23278) | media | nombre parecido; 1 día en común de 1 de Zomatik (y de 1 nuestros), 64 % de los m³ (9 contra 14), misma planta |
| RODRIGO | 3 | RODRIGO MAGALLANES (23192) | media | Nombre parecido; 1 día en común de 1 de Zomatik (y de 1 nuestros), 100 % de los m³ (13 contra 13), misma planta |
| DENIS | 2 | DENIS LA CAROLINA (18933) | media | Nombre parecido; 1 día en común de 3 de Zomatik (y de 2 nuestros), 100 % de los m³ (8.5 contra 8.5), misma planta |
| HERNAN-BRANDSEN | 2 | HERNAN (17680) | media | Nombre parecido; sin remitos en Zomatik desde abril (acá 1 días con despachos) |
| PEDRO | 2 | PEDRO CONSTRUCCIONES (17869) | media | Nombre parecido; 1 día en común de 1 de Zomatik (y de 1 nuestros), 100 % de los m³ (10 contra 10), misma planta |
| L645 Santa Clara al Sur | 1 | FIDEICOMISO SANTA CLARA AL SUR (18846) | media | Nombre parecido; sin remitos en Zomatik desde abril (acá 1 días con despachos) |
| Sergio | 1 | SERGIO LOPEZ (23171) | media | Nombre parecido; 1 día en común de 1 de Zomatik (y de 1 nuestros), 100 % de los m³ (8 contra 8), misma planta |
| Martin | 1 | MARTIN CABALLERO (17693) | media | nombre parecido; 1 día en común de 1 de Zomatik (y de 1 nuestros), 100 % de los m³ (4 contra 4), misma planta |
| Esteban | 1 | ESTEBAN EL PATO (19546) | media | Nombre parecido; 1 día en común de 1 de Zomatik (y de 1 nuestros), 100 % de los m³ (2 contra 2), misma planta |
| MARIANO | 1 | MARIANO PARQUE PEREYRA (19064) | media | nombre parecido; 1 día en común de 1 de Zomatik (y de 1 nuestros), 100 % de los m³ (3 contra 3), misma planta |
| Pueblos del plata ñ | 1 | CLUB SOCIAL PUEBLOS DEL PLATA S.A. (17511) | media | Nombre parecido; 1 día en común de 1 de Zomatik (y de 1 nuestros), 100 % de los m³ (5 contra 5), misma planta |
| BRANDSEN MATIAS | 21 | MATIAS ECHEVERRY (23350) | baja | nombre parecido; 3 días en común de 9 de Zomatik (y de 4 nuestros), 95 % de los m³ (139 contra 147), 1 día solo en la otra planta; también propuesto para «MATIAS» (duplicado nuestro: unificar) |
| Merva sa | 9 | MERVA S.A. (24644) | baja | Nombre igual, pero hay otro cliente nuestro igual; 5 días en común de 19 de Zomatik (y de 5 nuestros), 80 % de los m³ (80 contra 64), 4 días solo en la otra planta; también propuesto para «MERVA SA» (duplicado nuestro: unificar) |
| La Tercera Camino real | 9 | FIDEICOMISO DISTRITO CAMINO REAL (21214) | baja | Nombre parecido; sin remitos en Zomatik desde abril (acá 3 días con despachos) |
| ING. ALLAN | 8 | victor ing allan (20141) | baja | Nombre parecido; sin remitos en Zomatik desde abril (acá 5 días con despachos) |
| SAN VICENTE - Daniel | 6 | DANIEL GABOTO 71 (19419) | baja | nombre parecido; sin remitos en Zomatik desde abril (acá 1 días con despachos) |
| BARRIO SAN SIMON | 3 | BARRIO SAN LUCAS (23023) | baja | Nombre parecido; sin remitos en Zomatik desde abril (acá 1 días con despachos) |
| Juan Ing. Allan | 2 | JUAN CRUZ PEREYRA ELCANO (23299) | baja | nombre parecido; sin movimientos desde abril para cruzar; también propuesto para «JUAN » (duplicado nuestro: unificar) |
| Aldo pisos alisados | 2 | SOTELO PISOS ALISADOS (23187) | baja | Nombre parecido; sin remitos en Zomatik desde abril (acá 1 días con despachos) |
| SAN VICENTE | 2 | ALSINA SAN ISIDRO (23181) | baja | nombre parecido; sin remitos en Zomatik desde abril (acá 1 días con despachos) |
| Laura Barrio Parque | 1 | GISELLA BARRIO PARQUE (23132) | baja | Nombre parecido; sin movimientos desde abril para cruzar |
| INDU HOME | 1 | JBRS S.A.S. - REAL HOME (24761) | baja | nombre parecido; sin remitos en Zomatik desde abril (acá 1 días con despachos) |
| BARRIO SANTA INES | 1 | YONTHAN BARRIO 11 (19728) | baja | nombre parecido; sin remitos en Zomatik desde abril (acá 1 días con despachos) |
| HUDSON LAGOOM | 1 | FERNANDO PILETAS HUDSON (20919) | baja | nombre parecido; sin remitos en Zomatik desde abril (acá 1 días con despachos) |
| Fernando | 1 | FENOMIX - MATERIALES SAN FERNANDO SA (20468) | baja | Nombre parecido; sin remitos en Zomatik desde abril (acá 1 días con despachos) |
| JUAN | 1 | JUAN CRUZ PEREYRA ELCANO (23299) | baja | nombre parecido; sin remitos en Zomatik desde abril (acá 1 días con despachos) |
| Fidel obra Lanus | 0 | FIDEL (20980) | baja | Nombre parecido; acá sin despachos desde abril (Zomatik 4 días); también propuesto para «FIDEL - Lanus» (duplicado nuestro: unificar) |
| Daniel | 0 | MATIAS DANIEL LUSNICH (24800) | baja | Nombre parecido; acá sin despachos desde abril (Zomatik 2 días); también propuesto para «LUSNICH MATIAS DANIEL» (duplicado nuestro: unificar) |
| Indu Home | 0 | JBRS S.A.S. - REAL HOME (24761) | baja | nombre parecido; sin movimientos desde abril para cruzar; también propuesto para «INDU HOME» (duplicado nuestro: unificar) |
| Fincas de San Vicente | 0 | DIEGO SAN VICENTE (24576) | baja | Nombre parecido; acá sin despachos desde abril (Zomatik 1 días) |
| Santa Clara L552 | 0 | MATIAS SANTA CLARA (23193) | baja | Nombre parecido; acá sin despachos desde abril (Zomatik 1 días) |

### Clientes nuestros sin par en Zomatik

Ni el nombre ni los días de despacho coinciden con ningún cliente de Zomatik. Puede ser un nombre de obra o de persona; si están en Zomatik con otro nombre, se eligen a mano en Vínculos.

| Nuestro | Despachos | Último despacho |
|---|---|---|
| FARIÑA | 129 | 24/08/26 |
| INARCH | 54 | 14/08/26 |
| LA TERCERA | 43 | 20/10/26 |
| RICARDO | 15 | 25/09/26 |
| TERRALAGOS | 7 | 15/09/26 |
| LA PROVIDENCIA | 4 | 20/08/26 |
| HISTÓRICO | 3 | 22/09/25 |
| AVANCES AMBIENTALES SA | 2 | 07/09/26 |
| VIEJO BUENO | 2 | 04/08/26 |
| Argentino | 2 | 15/10/26 |
| Aisa | 1 | 30/06/26 |
| Yamil | 1 | 28/08/26 |
| Chino | 1 | 24/09/26 |
| Acosta | 0 | — |

### Duplicados nuestros

Clientes de Rebucret con el mismo nombre (normalizado) o el mismo CUIT válido. Conviene unificarlos antes de vincular: Zomatik es uno solo.

| Grupo | Clientes (despachos) |
|---|---|
| MERVA | Merva sa (9) · MERVA SA (46) |
| HOME INDU | Indu Home (0) · INDU HOME (1) |
| AMBIENTALES AVANCES | AVANCES AMBIENTALES SA (2) · AVANCES AMBIENTALES (0) |
| TERCERA | Fideicomiso La Tercera (429) · LA TERCERA (43) |
| CUIT 20310106284 | SANTA CLARA (15) · LUSNICH MATIAS DANIEL (19) |

## 2. Fórmulas

| Nuestra | Planta | Propuesta Zomatik | Confianza | Motivo |
|---|---|---|---|---|
| RDC-300 (CAN) | Canning | RDC MORTERO 300 (10000300) | alta | nombre parecido (1) · 2 de 2 días con remito de ese artículo |
| H40-6/12-15 | Canning | H40-612-15 B (CAN) (10090039) | alta | nombre parecido (1) · 3 de 4 días con remito de ese artículo |
| RDC-300 | Hudson | RDC MORTERO 300 (10000300) | alta | nombre parecido (1) · 2 de 2 días con remito de ese artículo |
| RDC-200 (CAN) | Canning | RDC MORTERO 200 (10090033) | media | nombre parecido (1) · sin despachos cruzables desde abril |
| H25-612-15 B (CAN) | Canning | H25-620-15 B (CAN) (10090040) | media | nombre parecido (0.75) · sin despachos cruzables desde abril |
| H21-612-15 B (CAN) | Canning | H21-620-15 B (CAN) (10090021) | media | nombre parecido (0.75) · 1 de 1 días con remito de ese artículo |
| H21-612-10 C (CAN) | Canning | H21-620-10 C (CAN) (10090020) | media | nombre parecido (0.75) · 0 de 1 días con remito de ese artículo |
| H25-620-15 B PELQUE (CAN) | Canning | H25-620-15 B (CAN) (10090040) | media | nombre parecido (0.8) · 0 de 1 días con remito de ese artículo |
| H30-Cordones C (CAN) | Canning | H30-612-10 C (CAN) (10090029) | media | nombre parecido (0.67) · 6 de 9 días con remito de ese artículo |
| H4-RECUPERADO (CAN) | Canning | H-CONTRAPISO (10000050) | media | por evidencia: 3 de 3 días los remitos de Zomatik llevan este artículo (el nombre sugería H4 C) |
| H25-6/20 (CAN) | Canning | H25-620-15 B (CAN) (10090040) | media | nombre parecido (1) · sin despachos cruzables desde abril |
| H21-6/20 (CAN) | Canning | H21-620-10 C (CAN) (10090020) | media | nombre parecido (1) · sin despachos cruzables desde abril |
| H25-620-15 C (CAN) | Canning | H25-620-15 B (CAN) (10090040) | media | nombre parecido (0.75) · 0 de 1 días con remito de ese artículo |
| H30-620-10 Pavimento (CAN) | Canning | H30-620-10 C (CAN) (10090027) | media | nombre parecido (0.75) · sin despachos cruzables desde abril |
| H8-620-15 | Hudson | H8-620-10 C (HUD) (10090007) | media | nombre parecido (0.67) · sin despachos cruzables desde abril |
| RDC-200 | Hudson | RDC MORTERO 200 (10090033) | media | nombre parecido (1) · sin despachos cruzables desde abril |
| H21-612-10 C | Hudson | H21-620-10 C (HUD) (10090012) | media | nombre parecido (0.75) · sin despachos cruzables desde abril |
| H30-620-10 Pavimento | Hudson | H30-620-10 C (HUD) (10090014) | media | nombre parecido (0.75) · sin despachos cruzables desde abril |
| H40-612-15 B | Hudson | H40-620-15 B (HUD) (10090034) | media | nombre parecido (0.75) · sin despachos cruzables desde abril |
| H25-6/20 | Hudson | H25-620-15 B (HUD) (10090013) | media | nombre parecido (1) · sin despachos cruzables desde abril |
| H25-612-10 C | Hudson | H25-612-15 B (HUD) PELQUE (10090018) | media | nombre parecido (0.5) · sin despachos cruzables desde abril |
| H25-612-15 B | Hudson | H25-612-15 B (HUD) PELQUE (10090018) | media | nombre parecido (1) · sin despachos cruzables desde abril |
| H25-620-10 C | Hudson | H25-620-15 B (HUD) (10090013) | media | nombre parecido (0.5) · sin despachos cruzables desde abril |
| H25-620-15 C | Hudson | H25-620-15 B (HUD) (10090013) | media | nombre parecido (0.75) · sin despachos cruzables desde abril |
| H30-612-10 C | Hudson | H30-620-10 C (HUD) (10090014) | media | nombre parecido (0.75) · sin despachos cruzables desde abril |
| H30-612-15 B | Hudson | H30-620-15 B (HUD) (10090015) | media | nombre parecido (0.75) · sin despachos cruzables desde abril |
| H30-Cordones C | Hudson | H30-620-10 C (HUD) (10090014) | media | nombre parecido (0.67) · sin despachos cruzables desde abril |
| H35-6/12-10 C | Hudson | H35-620-10 C (HUD) (10090024) | media | nombre parecido (0.75) · sin despachos cruzables desde abril |
| H4-RECUPERADO | Hudson | H4 C (10090001) | media | nombre parecido (0.5) · sin despachos cruzables desde abril |
| H40-620-10 C | Hudson | H40-620-15 B (HUD) (10090034) | media | nombre parecido (0.5) · sin despachos cruzables desde abril |
| H25-620-10 C (CAN) | Canning | H25-620-15 B (CAN) (10090040) | baja | nombre parecido (0.5) · 0 de 2 días con remito de ese artículo |

**Sin propuesta** (no hay artículo parecido en Zomatik ni evidencia):

- H25-612-10 C (CAN) (Canning) · 1 días despachada desde abril
- H8-620-10 C (CAN) (Canning)
- H8-620-15 (CAN) (Canning)
- H35-620-15 B (CAN) (Canning)
- H35-620-10 C (CAN) (Canning)
- H35-6/12-10 C (CAN) (Canning)
- H35-6/12-15 B (CAN) (Canning) · 2 días despachada desde abril

## 3. Proyectos (acopios) ↔ obras

En Zomatik no hay maestro de obras: nuestras obras se vinculan a través de los proyectos. Para cada proyecto abierto, la obra nuestra propuesta.

| Proyecto | Cliente · obra en Zomatik | Última entrega | Obra nuestra propuesta | Confianza | Motivo |
|---|---|---|---|---|---|
| PRO 0001-00000030 | FIDEICOMISO LA TERCERA · PAVIMENTO LT 1 | 20/10/26 | PAVIMENTO (Fideicomiso La Tercera) | alta | 20 días en común de 23, 93 % de los m³ (1195 contra 1284) · nombre 100 % · cliente vinculado |
| PRO2 0001-00000013 | FIDEICOMISO LA TERCERA · CORDONES SOBRE SUELO CAL | 15/10/26 | CORDONES (Fideicomiso La Tercera) | alta | 3 días en común de 4, 100 % de los m³ (30.5 contra 30.5) · nombre 100 % · cliente vinculado |
| PRO 0001-00000025 | FIDEICOMISO LA TERCERA · INGRESO LA TERCERA - H21 COPA DEL MUNDO (2) | 18/09/26 | CORDONES (Fideicomiso La Tercera) | alta | 3 días en común de 3, 100 % de los m³ (9 contra 9) · cliente vinculado |
| PRO 0001-00000029 | LA HUELLA FIDEICOMISO · LA HUELLA - ACCESO | 18/08/26 | La huella (LA HUELLA) | alta | 5 días en común de 6, 100 % de los m³ (135.5 contra 135.5) · nombre 100 % · cliente vinculado |
| PRO 0001-00000031 | FIDEICOMISO LA TERCERA · PLATEAS CANCHAS DE PADEL Y TENIS | 28/09/26 | CANCHA PADEL (LA TERCERA) | media | 1 día en común de 1, 69 % de los m³ (106 contra 73) · nombre 50 % · cliente vinculado |
| PRO2 0001-00000009 | FIDEICOMISO DAMASIA AL SUR · FARINA ETAPA 2 | 21/08/26 | Calle Fariña (DAMASIA) | media | 0 días en común de 10, 0 % de los m³ (0 contra 0) · nombre 50 % · cliente vinculado |
| PRO2 0001-00000010 | FIDEICOMISO LA TERCERA · DARSENAS C.REAL | 21/06/26 | CORDONES (Fideicomiso La Tercera) | media | 2 días en común de 2, 61 % de los m³ (10 contra 16.5) · cliente vinculado |
| PRO2 0001-00000008 | FIDEICOMISO DAMASIA AL SUR · CCTS PLAY - PLAZA DAMASIA (FASE EN 2) | 29/04/26 | Damasia (DAMASIA) | media | 1 día en común de 1, 100 % de los m³ (9 contra 9) · nombre 100 % · cliente vinculado |
| PRO 0001-00000022 | FIDEICOMISO LA TERCERA · LA TERCERA ACCESO Y COPA DEL MUNDO | 30/01/26 | La tercera (Fideicomiso La Tercera) | media | sin remitos del proyecto desde abril para cruzar · nombre 100 % · cliente vinculado |
| PRO2 0001-00000012 | FIDEICOMISO LA TERCERA · PAVIMENTO LA3 FASE 2 | — | PAVIMENTO (Fideicomiso La Tercera) | media | sin remitos del proyecto desde abril para cruzar · nombre 100 % · cliente vinculado |
| PRO 0001-00000019 | FIDEICOMISO LA TERCERA · CORDONES ENTRADA LA 3 | — | CORDONES (Fideicomiso La Tercera) | media | sin remitos del proyecto desde abril para cruzar · nombre 100 % · cliente vinculado |
| PRO 0001-00000028 | FIDEICOMISO DAMASIA AL SUR · FARINA ETAPA 1 | 21/08/26 | PAVIMENTO (DAMASIA) | baja | 4 días en común de 8, 47 % de los m³ (665 contra 313) · cliente vinculado |
| PRO 0001-00000027 | FIDEICOMISO DAMASIA AL SUR · INGRESO LA 3 - ETAPA 2 | 03/06/26 | Damasia (DAMASIA) | baja | 5 días en común de 12, 5 % de los m³ (348 contra 17) · cliente vinculado |
| PRO 0001-00000024 | FIDEICOMISO DAMASIA AL SUR · ARREGLO BASE TENIS | 16/03/26 | Calle Fariña (DAMASIA) | baja | sin remitos del proyecto desde abril para cruzar · cliente vinculado |
| PRO 0001-00000014 | FIDEICOMISO LAS VICTORIAS · — | 03/11/25 | LAS VICTORIAS (LAS VICTORIAS) | baja | sin remitos del proyecto desde abril para cruzar · cliente por nombre igual |
| PRO 0001-00000013 | FIDEICOMISO DAMASIA AL SUR · — | 20/10/25 | Calle Fariña (DAMASIA) | baja | sin remitos del proyecto desde abril para cruzar · cliente vinculado |
| PRO 0001-00000017 | FIDEICOMISO LAS VICTORIAS · DARSENA LV | 18/08/25 | LAS VICTORIAS (LAS VICTORIAS) | baja | sin remitos del proyecto desde abril para cruzar · cliente por nombre igual |
| PRO 0001-00000004 | FIDEICOMISO LAS VICTORIAS · — | 10/10/24 | LAS VICTORIAS (LAS VICTORIAS) | baja | sin remitos del proyecto desde abril para cruzar · cliente por nombre igual |
| PRO 0001-00000012 | CLUB SOCIAL PUEBLOS DEL PLATA S.A. · — | 28/06/24 | Calle 63 (Pueblos del plata ñ) | baja | sin remitos del proyecto desde abril para cruzar · cliente propuesto (media) |
| PRO 0001-00000003 | CLUB SOCIAL PUEBLOS DEL PLATA S.A. · — | 15/03/23 | Calle 63 (Pueblos del plata ñ) | baja | sin remitos del proyecto desde abril para cruzar · cliente propuesto (media) |
| PRO 0001-00000023 | FIDEICOMISO DAMASIA AL SUR · CCTS PLAY PLAZA (1) | — | Calle Fariña (DAMASIA) | baja | sin remitos del proyecto desde abril para cruzar · cliente vinculado |
| PRO 0001-00000010 | FIDEICOMISO DAMASIA AL SUR · — | — | Calle Fariña (DAMASIA) | baja | sin remitos del proyecto desde abril para cruzar · cliente vinculado |
| PRO 0001-00000009 | FIDEICOMISO LAS VICTORIAS · — | — | LAS VICTORIAS (LAS VICTORIAS) | baja | sin remitos del proyecto desde abril para cruzar · cliente por nombre igual |
| PRO 0001-00000020 | VERONICA ANDREA COSTA · — | 14/01/26 | — | — | el cliente de Zomatik no tiene par en Rebucret |
| PRO 0001-00000016 | FIDEICOMISO DISTRITO CAMINO REAL · — | 06/08/25 | — | — | el cliente de Zomatik no tiene par en Rebucret |
| PRO 0001-00000015 | PELQUE S.A - OCSA S.A. U.T - POLO EDUCATIVO · — | 06/06/25 | — | — | el cliente de Zomatik no tiene par en Rebucret |
| PRO 0001-00000008 | FIDEICOMISO ELCANO · — | 28/02/24 | — | — | el cliente de Zomatik no tiene par en Rebucret |
| PRO 0001-00000002 | FIDEICOMISO ELCANO · — | 19/07/23 | — | — | el cliente de Zomatik no tiene par en Rebucret |
| PRO 0001-00000021 | FIDEICOMISO LA FORESTADA - PUEBLO DE MAR · — | — | — | — | el cliente de Zomatik no tiene par en Rebucret |
| PRO 0001-00000011 | FIDEICOMISO INMOBILIARIO - BARRIO PRIVADO EL OLIVAR · — | — | — | — | el cliente de Zomatik no tiene par en Rebucret |
| PRO2 0001-00000006 | LA HORQUETA - SEGUROLA · — | — | — | — | el cliente de Zomatik no tiene par en Rebucret |
| PRO 0001-00000007 | PROYECTAR TU CASA S.A. · — | — | — | — | el cliente de Zomatik no tiene par en Rebucret |
| PRO2 0001-00000005 | FIDEICOMISO INMOBILIARIO - BARRIO PRIVADO EL OLIVAR · — | — | — | — | el cliente de Zomatik no tiene par en Rebucret |

### Obras con despachos en los últimos 90 días sin proyecto

Van con **NP común** (sin proyecto de Zomatik).

| Obra | Cliente | Despachos | m³ | Último | En Zomatik |
|---|---|---|---|---|---|
| PAVIMENTO | FARIÑA | 87 | 686 | 24/08/26 | sin proyecto (va con NP común) |
| Pueblos del plata | Desarrollos constructivos sudamericanos | 38 | 314 | 19/09/26 | sin proyecto (va con NP común) |
| RESTAURANTE | Fideicomiso La Tercera | 35 | 274 | 04/09/26 | sin proyecto (va con NP común) |
| PLATANOS | MERVA SA | 34 | 267 | 25/09/26 | sin proyecto (va con NP común) |
| LA TERCERA | LA TERCERA | 34 | 255.5 | 20/10/26 | sin proyecto (va con NP común) |
| Educacion popular | INARCH | 27 | 213 | 14/08/26 | sin proyecto (va con NP común) |
| La tercera losa de restorant | Fideicomiso La Tercera | 20 | 157 | 08/09/26 | sin proyecto (va con NP común) |
| PLATEA | Fideicomiso La Tercera | 18 | 144 | 02/10/26 | sin proyecto (va con NP común) |
| ESTADIO | Fideicomiso La Tercera | 14 | 110 | 01/09/26 | sin proyecto (va con NP común) |
| Etcheverry | MATIAS | 14 | 98.5 | 09/10/26 | sin proyecto (va con NP común) |
| RACEDO | A.A. ARQUITECTURA | 12 | 94 | 14/08/26 | sin proyecto (va con NP común) |
| SPORTING | CARLOS ARQUITECTO | 10 | 74 | 07/09/26 | sin proyecto (va con NP común) |
| SANTA CLARA | TOP | 23 | 70 | 20/10/26 | sin proyecto (va con NP común) |
| El peligro | RICARDO | 10 | 66 | 21/08/26 | sin proyecto (va con NP común) |
| Camino real | La Tercera Camino real | 8 | 59.5 | 14/10/26 | sin proyecto (va con NP común) |
| Santa Clara L552 | LUSNICH MATIAS DANIEL | 19 | 55 | 30/07/26 | sin proyecto (va con NP común) |
| SAN VICENTE | FELICIANO | 6 | 51.5 | 11/09/26 | sin proyecto (va con NP común) |
| BASES | Fideicomiso La Tercera | 6 | 48 | 25/08/26 | sin proyecto (va con NP común) |
| Bernal | PATRICIO | 6 | 44 | 24/09/26 | sin proyecto (va con NP común) |
| Bases estadio La Tercera | Fideicomiso La Tercera | 4 | 33 | 30/07/26 | sin proyecto (va con NP común) |
| CANCHA PADEL | Fideicomiso La Tercera | 4 | 33 | 24/09/26 | sin proyecto (va con NP común) |
| BEL STUDIO | Paisa | 4 | 26.5 | 02/10/26 | sin proyecto (va con NP común) |
| San Roque | OKIOS | 5 | 26 | 11/09/26 | sin proyecto (va con NP común) |
| VIGAS | Fideicomiso La Tercera | 3 | 24 | 14/08/26 | sin proyecto (va con NP común) |
| Camino general belgrano | ALDO | 4 | 22.5 | 08/10/26 | sin proyecto (va con NP común) |
| CHACRAS DE SAN VICENTE | CARLOS ARQUITECTO | 4 | 22.5 | 03/09/26 | sin proyecto (va con NP común) |
| Greenville | Cacho | 2 | 19 | 14/10/26 | sin proyecto (va con NP común) |
| C.A.B.A. | AVANCES AMBIENTALES SA | 2 | 18.5 | 07/09/26 | sin proyecto (va con NP común) |
| OKIOS | TERRALAGOS | 6 | 18 | 11/08/26 | sin proyecto (va con NP común) |
| OKIOS | BARRIO SAN SIMON | 3 | 18 | 01/09/26 | sin proyecto (va con NP común) |
| ING. ALLAN | ING. ALLAN | 3 | 17 | 19/10/26 | sin proyecto (va con NP común) |
| Parque industrial | Merva sa | 2 | 16 | 11/08/26 | sin proyecto (va con NP común) |
| Quilmes | Aldo pisos alisados | 2 | 16 | 10/08/26 | sin proyecto (va con NP común) |
| San vicente sporting club | A.A. ARQUITECTURA | 2 | 16 | 09/09/26 | sin proyecto (va con NP común) |
| Cerco Perimetral | Fideicomiso La Tercera | 4 | 15 | 10/09/26 | sin proyecto (va con NP común) |
| EL CANO | PATRICIO | 3 | 15 | 10/08/26 | sin proyecto (va con NP común) |
| El pato | FIDEL - Lanus | 2 | 15 | 22/09/26 | sin proyecto (va con NP común) |
| PELQUE | PELQUE | 2 | 15 | 19/10/26 | sin proyecto (va con NP común) |
| MARIANO 27.283.711 | SANTA CLARA | 5 | 14 | 23/09/26 | sin proyecto (va con NP común) |
| ETCHEVERRY | RICARDO | 2 | 13 | 18/09/26 | sin proyecto (va con NP común) |
| Ranelag | HERNÁN PILETAS | 2 | 13 | 18/09/26 | sin proyecto (va con NP común) |
| Sourigues | Argentino | 2 | 13 | 15/10/26 | sin proyecto (va con NP común) |
| providencia | LA PROVIDENCIA | 4 | 11.5 | 20/08/26 | sin proyecto (va con NP común) |
| LA MAGDALENA | A.A. ARQUITECTURA | 2 | 11 | 31/08/26 | sin proyecto (va con NP común) |
| Quilmes | Angel | 3 | 11 | 08/10/26 | sin proyecto (va con NP común) |
| FINCAS JOVEN | OKIOS | 3 | 11 | 18/09/26 | sin proyecto (va con NP común) |
| Magallanes 276 | FIDEL - Lanus | 2 | 10 | 25/09/26 | sin proyecto (va con NP común) |
| BRANDSEN | RICARDO | 2 | 9.5 | 30/07/26 | sin proyecto (va con NP común) |
| Altos 2 | HERNÁN PILETAS | 1 | 8.5 | 21/10/26 | sin proyecto (va con NP común) |
| El PATO | Sergio | 1 | 8 | 28/08/26 | sin proyecto (va con NP común) |
| QUILMES | VIEJO BUENO | 1 | 8 | 04/08/26 | sin proyecto (va con NP común) |
| ALDO | ALDO | 1 | 8 | 10/08/26 | sin proyecto (va con NP común) |
| Barrio el parque | Francis | 1 | 8 | 23/09/26 | sin proyecto (va con NP común) |
| El Carmencito | HERNÁN PILETAS | 1 | 8 | 25/09/26 | sin proyecto (va con NP común) |
| RUTA N°2 - KM 46 | RICARDO | 1 | 8 | 25/09/26 | sin proyecto (va con NP común) |
| Hudson park | Luciano | 2 | 7.5 | 19/10/26 | sin proyecto (va con NP común) |
| Puerto Nizuc | HERNÁN PILETAS | 2 | 7 | 06/10/26 | sin proyecto (va con NP común) |
| NACHO | Fideicomiso La Tercera | 2 | 5.5 | 06/10/26 | sin proyecto (va con NP común) |
| San Francisco Solano | Angel | 1 | 5 | 11/09/26 | sin proyecto (va con NP común) |
| Estación de Quilmes | Chino | 1 | 5 | 24/09/26 | sin proyecto (va con NP común) |
| Calle 63 | Pueblos del plata ñ | 1 | 5 | 05/10/26 | sin proyecto (va con NP común) |
| Gral arredondo 6658 | Cebolla Guinche | 1 | 4 | 29/08/26 | sin proyecto (va con NP común) |
| Lanus | Martin | 1 | 4 | 11/09/26 | sin proyecto (va con NP común) |
| HUDSON | HUDSON LAGOOM | 1 | 4 | 15/09/26 | sin proyecto (va con NP común) |
| El pato | JUAN | 1 | 4 | 10/10/26 | sin proyecto (va con NP común) |
| Greenville, | MATIAS | 1 | 4 | 13/10/26 | sin proyecto (va con NP común) |
| SANTA INES | BARRIO SANTA INES | 1 | 3 | 10/08/26 | sin proyecto (va con NP común) |
| Hudson | Yamil | 1 | 3 | 28/08/26 | sin proyecto (va con NP común) |
| El PATO | MARIANO | 1 | 3 | 02/10/26 | sin proyecto (va con NP común) |
| EZPELETA | Fernando | 1 | 3 | 06/10/26 | sin proyecto (va con NP común) |
| SAN SIMÓN | OKIOS | 1 | 2 | 29/07/26 | sin proyecto (va con NP común) |
| V+V Construcciones | TERRALAGOS | 1 | 2 | 15/09/26 | sin proyecto (va con NP común) |
| Gaboto | ALDO | 1 | 2 | 23/09/26 | sin proyecto (va con NP común) |
| Pueblos del plata | Esteban | 1 | 2 | 24/09/26 | sin proyecto (va con NP común) |

## 4. Clientes de Zomatik con remitos en el año que no están en Rebucret

Ni vinculados ni propuestos (con confianza media o alta) para un cliente nuestro. Se traen con **"Traer"** en Vínculos con Zomatik (pestaña "En Zomatik sin cliente nuestro") o desde el alta de cliente.

| Cliente de Zomatik | Código | Remitos en el año | Último | Localidad |
|---|---|---|---|---|
| C&E CONSTRUCCIONES S.A. | 21188 | 19 | 14/04/26 | CABA |
| ENERBUL S. A. | 23335 | 11 | 16/03/26 | AVELLANEDA |
| VERONICA ANDREA COSTA | 22886 | 10 | 14/01/26 | MORON |
| OBRA PROPIA REBUCRET | 15893 | 9 | 21/06/26 |  |
| ARQ INDUS HOMES | 22527 | 9 | 13/05/26 |  |
| MATIAS SANTA CLARA | 23193 | 6 | 27/04/26 |  |
| PELQUE S.A - OCSA S.A. U.T - POLO EDUCATIVO | 21010 | 5 | 22/10/25 | RANELAGH |
| ORLANDO BOMBA | 22752 | 4 | 19/03/26 |  |
| DISTRIBUIDORA MOTORTRANS S.A. | 19017 | 4 | 12/12/25 | BARRACAS |
| Emanuel piletas | 17909 | 4 | 27/01/26 |  |
| GISELLA BARRIO PARQUE | 23132 | 3 | 09/04/26 |  |
| Barrio La Huella | 23319 | 3 | 17/04/26 |  |
| CONCRETUS SA | 15870 | 3 | 10/08/26 |  |
| MATIAS ARQUITECTO | 19168 | 3 | 23/06/26 |  |
| RACUK IVAN | 19583 | 3 | 02/03/26 | EZPELETA |
| RIGIRACCIOLO OSVALDO JOSE Y RIGIRACCIOLO ALBERTO LUIS SOCIEDAD DE HECHO | 24710 | 3 | 27/05/26 | VILLA DOMINICO |
| ATHILIO VIAL | 23290 | 2 | 05/02/26 |  |
| Elizabeth Las Victorias | 23338 | 2 | 26/02/26 |  |
| GERMAN RANHEGLA | 23141 | 2 | 02/12/25 |  |
| SOTELO PISOS ALISADOS | 23187 | 2 | 13/01/26 |  |
| AGUSTINE HECTOR DANIEL | 20102 | 2 | 16/03/26 |  |
| CARLOS MAGALLANES | 22646 | 2 | 26/11/25 |  |
| COFIL SRL | 24718 | 2 | 12/06/26 | BERNAL |
| CRESATA S A | 24604 | 2 | 12/06/26 | SAN LUIS |
| CRISTIAN FALLER | 23264 | 2 | 05/02/26 | Canning |
| DIEGO SAN VICENTE | 24576 | 2 | 17/04/26 |  |
| EL DOCENTE BONAERENSE S.R.L. | 22929 | 2 | 26/11/25 | AVELLANEDA |
| FARMACIA NOBEL | 19681 | 2 | 19/12/25 |  |
| La Arbolada | 17892 | 2 | 31/10/25 |  |
| LA CAPILLA | 19653 | 2 | 20/01/26 |  |
| MARTIN PILETAS | 20870 | 2 | 31/03/26 |  |
| AIXA ELCANO | 24768 | 1 | 30/06/26 |  |
| WT GRAFICA SRL | 24922 | 1 | 15/09/26 | ZELAYA |
| CARLOS PAREDES | 23037 | 1 | 18/02/26 |  |
| JUAN LOPEZ | 22643 | 1 | 14/10/26 |  |
| JULIO HUDSON PARK | 20859 | 1 | 15/10/26 |  |
| CARLOS FRAN MAQUINA | 23316 | 1 | 18/02/26 |  |
| EDGAR CONTRATISTA | 22745 | 1 | 22/10/25 |  |
| MARIO CELINA | 23291 | 1 | 10/02/26 |  |
| NICOLAS CONTRATISTA | 22982 | 1 | 15/09/26 |  |
| VICTOR PISOS ALISADOS | 23191 | 1 | 23/12/25 |  |
| BRAYAN CONTRATISTA | 24571 | 1 | 16/03/26 |  |
| CARLOS NAVES INDUSTRIALES | 22900 | 1 | 22/10/25 |  |
| CONSTRUCCIONES FUNCIONALES S.A | 23107 | 1 | 15/11/25 |  |
| CONSTRUCTORA ALMAJO NORTE S.R.L. | 23289 | 1 | 05/02/26 | BELLA VISTA |
| DANIEL AVILA | 20979 | 1 | 23/01/26 |  |
| DANIEL FIOROTO | 18147 | 1 | 22/12/25 |  |
| DANIEL MORABI | 17817 | 1 | 05/01/26 |  |
| EMILIANO VILLALOBOS 92 | 19279 | 1 | 11/11/25 |  |
| FEDERICO (BOMBA) | 17709 | 1 | 28/11/25 |  |
| FER IGLESIA | 21165 | 1 | 21/06/26 |  |
| FRNCIS | 19236 | 1 | 27/03/26 |  |
| GASTON MAGALLANES 359 | 20485 | 1 | 03/12/25 |  |
| GELCO&PLAST S.R.L. | 23041 | 1 | 25/10/25 | QUILMES |
| GUTIERREZ DIEGO MARIANO | 21061 | 1 | 27/05/26 | JUAN M. GUTIERREZ |
| HUGO BARRIO 11 | 20889 | 1 | 13/04/26 |  |
| JAVIER CORRALON | 20494 | 1 | 10/12/25 |  |
| jhonny barja cervantes | 23186 | 1 | 19/12/25 |  |
| KAVOS S.A. - C&E CONSTRUCCIONES S.A. - UT - LP 16-2024 | 23163 | 1 | 09/12/25 |  |
| LEPRIS | 24655 | 1 | 27/04/26 |  |
| MADERERA BARRIO 11 | 19442 | 1 | 18/11/25 |  |
| MAS HOUSE | 24849 | 1 | 26/08/26 |  |
| MATIAS AGALLANES 345 | 19169 | 1 | 04/08/26 |  |
| Matias magallanes 106 | 20712 | 1 | 10/03/26 |  |
| MATIAS TRANMIX | 17815 | 1 | 25/03/26 |  |
| MEGAPOLL GUNITADO | 19108 | 1 | 05/12/25 |  |
| MOLLUSO CLAUDIO ROMAN | 18509 | 1 | 27/05/26 | QUILMES |
| Pablo Claypole | 23170 | 1 | 16/12/25 |  |
| pablo palavecino | 20686 | 1 | 12/11/25 |  |
| Palacios Esteban Echeverria | 23185 | 1 | 19/12/25 | Esteban Echeverria |
| PAULA MAGALLANES 30 | 18507 | 1 | 02/03/26 |  |
| RAUL GABOTO | 18826 | 1 | 23/12/25 |  |
| RICRDO VERA CONTRATISTA | 19163 | 1 | 21/08/26 |  |
| ROBERTO | 17687 | 1 | 29/10/25 |  |
| SOLANO NORBERTO ANIBAL | 19795 | 1 | 17/01/26 | JUAN M. GUTIERREZ |
