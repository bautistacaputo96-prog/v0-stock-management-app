# Puente Rebucret · cómo instalarlo en la PC de la planta (Canning)

El puente es un programa chiquito que queda andando en la PC de Indumix. **Solo mira** la planta (recetas, cargas,
humedad, alarmas) y lo manda al sistema. **No carga, no para y no cambia nada de la planta.**

Tarda unos 15 minutos. No hace falta ser administrador.

## Antes de empezar

- La PC tiene que tener **Windows 10 u 11 de 64 bits** (Inicio › Configuración › Sistema › Acerca de › "Tipo de
  sistema: 64 bits"). Con Windows 7 no anda.
- La PC tiene que tener **internet** y seguir conectada a Indumix (la pantalla de Indumix tiene que andar).
- Tené a mano la **clave del puente**: en el sistema, Carga de planta › Recetas de la planta › bloque **Puente** ›
  **Generar clave del puente** › **Copiar**. Se ve una sola vez: pasala a la PC de la planta (por ejemplo, mandándotela
  por mail o WhatsApp web y copiándola desde ahí).

## Pasos

1. **Copiá la carpeta.** La carpeta es `puente-carga` del sistema (la que tiene este LEEME; Bautista la pasa en un
   pendrive). Copiala adentro de tu carpeta de usuario con el nombre `rebucret-puente`:
   `C:\Users\<tu usuario>\rebucret-puente\`. Tiene que quedar `puente.mjs`, `indumix-xml.mjs`, `instalar.cmd`,
   `iniciar.cmd` y `config.ejemplo.json`.
2. **Bajá Node.** Entrá a <https://nodejs.org/en/download> y bajá **Node 22 (LTS) para Windows 64 bits en .zip**
   ("Standalone binary .zip"). Descomprimilo, y de lo descomprimido copiá todo el contenido dentro de una carpeta nueva
   llamada `node` dentro de `rebucret-puente`. Tiene que quedar `C:\Users\<tu usuario>\rebucret-puente\node\node.exe`.
3. **Instalá.** Hacé doble clic en `instalar.cmd`. Si Windows pregunta "¿Querés ejecutarlo?", decí que sí. Cuando pida
   la clave, pegala (clic derecho pega) y apretá Enter. Tiene que decir **"Listo: el puente quedó andando"**.
4. **Fijate que ande.** Abajo, en la barra de tareas, queda una ventana minimizada que se llama
   **"PUENTE REBUCRET - NO CERRAR"**. No la cierres. En el sistema, Carga de planta (Canning) tiene que decir
   **"Indumix · solo lectura"** y **"Datos de hace … s"**. Las 20 recetas aparecen en Recetas de la planta en unos minutos.
5. **Reiniciá una vez la PC** y fijate que la ventana "PUENTE REBUCRET - NO CERRAR" vuelva a aparecer sola.
6. **Dejá abierta la pantalla de carga.** En la misma PC, abrí Edge en una segunda ventana con
   <https://www.produccionrebucret.com/carga>, al lado de Indumix. Ahí aparecen los avisos de humedad y de la Tolva 1.

## Si algo no anda

- **"Sin datos del puente"** en el sistema: fijate que la ventana "PUENTE REBUCRET - NO CERRAR" esté abierta. Si no
  está, hacé doble clic en `iniciar.cmd`.
- **"La clave del puente no anda"** en la ventana: generá una clave nueva en el sistema y volvé a correr `instalar.cmd`.
- **"Sin red con Indumix"**: el cable entre la PC e Indumix. Cuando vuelve, el puente sigue solo.
- Sin internet no se pierde nada: lo guarda en la carpeta `cola` y lo sube cuando vuelve.
- Lo que hizo el puente queda anotado en la carpeta `registro` (un archivo por día, se guardan 14 días). Si hay que
  revisar algo, mandá el archivo del día.

## Cosas a saber

- Para leer un reporte o una receta, Indumix obliga a poner su número en pantalla. El puente lo hace solo con la planta
  quieta y si nadie tocó REPORTE o RECETAS en los últimos 2 minutos, y lo deja como estaba. Si alguien está mirando esas
  pantallas puede ver que el número salta un segundo: es el puente. **Si estás editando una receta, guardala antes de
  dejar la PC.**
- Para desinstalar: borrá `Puente Rebucret.cmd` de la carpeta Inicio (tecla Windows + R, escribí `shell:startup`,
  Enter) y cerrá la ventana del puente.
- **Recomendado (seguridad):** que el wifi de la planta tenga clave WPA2/WPA3 y no se comparta con choferes ni visitas
  (red de invitados aparte). Hoy cualquier equipo conectado a la red de la planta puede manejar Indumix, con o sin puente.
- Una versión nueva del puente se instala a mano: se reemplazan `puente.mjs` e `indumix-xml.mjs` y se reinicia la PC.
