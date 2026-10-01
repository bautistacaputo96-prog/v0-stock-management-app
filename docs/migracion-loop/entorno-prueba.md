# Entorno de prueba de Rebucret

Pedido de Bautista (01/10/2026): las fases grandes se prueban y se practican en un link de prueba antes de publicarlas, para que el equipo no se encuentre al día siguiente con algo que no sabe usar.

## Decisión (01/10/2026)

Supabase gratis no permite una tercera base: la cuenta ya usa las 2 del plan Free (Rebucret y Concretus). La Pro cuesta US$25/mes más ~US$10 por la base de prueba. **Bautista eligió la opción gratis: modo prueba por usuario.**
- Cada usuario de `app_users` tiene `ve_funciones_nuevas` (boolean, por defecto false).
- Las funciones nuevas de una fase se publican **apagadas**: solo las ven los usuarios con la marca, en un principio Bautista y quienes programan.
- Llevan un distintivo "Nuevo · en prueba".
- Practican con datos reales. En la Fase 2 eso es seguro, porque armar viajes no toca stock.
- Cuando están cómodos, Bautista prende la marca para todos o se quita el interruptor.
- La marca la administra un supervisor desde Actividad › "Funciones nuevas" (lista de usuarios con un interruptor).
- Para la Fase 3 (despacho) se vuelve a evaluar una base aparte.

Lo que sigue abajo es la propuesta original, que queda como referencia.

## Problema

Hoy el preview de Vercel de cada rama usa **la misma base que producción**: lo que se carga ahí es real (descuenta stock, sale en Historial y en el WhatsApp de Concretus). Sirve para mirar, no para practicar.

## Propuesta

1. **Base de prueba:** un proyecto de Supabase aparte ("rebucret-prueba"), gratis.
   - Se arma con `supabase/migrations/000000000000_esquema_base.sql` más las migraciones posteriores.
   - Se carga con una **copia de los datos reales**: plantas, materiales y stock, fórmulas, clientes, obras, camiones, choferes, bombas, pedidos y despachos recientes, probetas.
   - Un script (`scripts/copiar-a-prueba.mjs`) la vuelve a copiar desde producción cuando haga falta. La copia **nunca** va de prueba a producción.
2. **Link de prueba:** los previews de Vercel (Preview) apuntan a la base de prueba con variables propias.
   - Opción preferida: variables nuevas solo para Preview, `NEXT_PUBLIC_SUPABASE_URL_PRUEBA`, `NEXT_PUBLIC_SUPABASE_ANON_KEY_PRUEBA` y `SUPABASE_SERVICE_ROLE_KEY_PRUEBA`. `lib/supabase/*` las usa si existen. Así no se tocan las variables de producción que maneja la integración de Supabase.
   - Un alias fijo para el link, por ejemplo `prueba-rebucret.vercel.app`, apuntando a la rama de la fase en curso.
3. **Cartel visible** en todas las pantallas del entorno de prueba: "MODO PRUEBA — nada de lo que hagas acá es real". Así nadie lo confunde con el sistema de verdad.
4. **Sin efectos externos desde prueba:**
   - el cron y los mails del reporte semanal no corren;
   - el aviso de borrado no manda mails;
   - el GPS muestra los camiones reales: es solo lectura, así que está bien.

## Qué hace falta de Bautista

- Crear el proyecto en Supabase. Lo crea él desde su cuenta, con guía; yo no creo cuentas ni manejo contraseñas. O que autorice a que lo cree desde su sesión ya iniciada.
- Que autorice a cargar las variables de Preview en Vercel.

## Qué hace el obrero

Script de copia, cambio en `lib/supabase/*`, cartel de modo prueba, apagar cron y mails en prueba, y documentar cómo refrescar la base.
