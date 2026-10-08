# Conectar el catálogo con Supabase

## Estado (07/10/2026)

- Proyecto de Supabase: **Catalago Marcial** (`tdyekqddpchjjiuhglhv`), separado de la app de pedidos.
- Esquema aplicado, con seguridad por filas, y probado con la clave pública.
- **Sincronización automática activa:** cada 10 minutos Supabase lee el catálogo de tu Apps Script (`?action=catalog`) y lo copia a las tablas. Es lo mismo que hace hoy la tarea programada de Insforge, así que **no hay que tocar el Apps Script**. Detalle en `02-sincronizacion.sql`.
- Primera sincronización: 322 productos (269 publicados, 53 ocultos) y 17 datos de configuración.
- `docs/config.js` apunta a este proyecto con `activo: true`. Insforge ya no se usa.

Para mirar cómo viene la sincronización (en el SQL Editor de Supabase):

```sql
select * from sincronizacion_log order by id desc limit 10;
```

## Pasos

1. **Crear el proyecto.** En supabase.com, un proyecto nuevo solo para el catálogo (no el de la app de pedidos). Anotá la contraseña de la base en un lugar seguro.
2. **Crear las tablas.** Abrí *SQL Editor → New query*, pegá todo `01-catalogo.sql` y tocá *Run*. (El orden es 01 → 02 → 03.) Al final tiene que mostrar 4 tablas con `seguridad_activada = true`.
3. **Copiar la URL y la clave pública.** En *Project Settings → API*: la *Project URL* y la clave **anon / publishable**. Estas dos sí se pueden pegar en el sitio.
4. **Encender el sitio.** En `docs/config.js`, bloque `SUPABASE`: pegá `URL` y `ANON` y poné `activo: true`.
5. **Cargar los datos.** Correr `02-sincronizacion.sql` en el SQL Editor. Programa la copia automática desde tu Apps Script y no hay que pegar nada en él. Se puede volver a correr sin romper nada.
6. **Registro de pedidos.** Correr `03-pedidos.sql`. Crea `registrar_pedido` con límite por IP, idempotencia y validación estricta, y borra la versión vieja sin límites. Correrlo **antes** de publicar el `app.js` nuevo.
7. **Probar.** Abrí el sitio con la consola del navegador abierta. No debería haber avisos de "Supabase no respondió". Mandá un pedido de prueba y mirá que aparezca en *Table Editor → pedidos_catalogo*.

## Qué puede y qué no puede hacer el sitio

| | Con la clave pública (la del sitio) |
|---|---|
| Leer productos publicados | Sí |
| Leer los textos de `config` | Sí (todo lo que esté ahí es público) |
| Leer o editar pedidos | **No** |
| Cambiar productos o precios | **No** |
| Registrar un pedido | Solo con `registrar_pedido`, que usa los precios de la base, no los del navegador |

## Cosas a tener en cuenta

- **Clave `service_role`:** es secreta, da acceso total. Solo va en las propiedades del script de Apps Script. Nunca en el repositorio, en `config.js` ni en un chat.
- **Pedidos de relleno:** cualquiera que conozca la clave pública puede llamar a `registrar_pedido`. Desde `03-pedidos.sql` la función limita a 5 pedidos cada 10 minutos y 30 por día por IP, y 150 por hora en total. Es una mitigación: el arreglo de fondo (endpoint de servidor con anti-robots) está en la Fase 3 de `auditoria/PLAN-MAESTRO.md`.
- **Salud de la sincronización:** `select * from estado_sincronizacion;` muestra la última corrida buena y cuántas fallaron seguidas. Si `antiguedad` pasa de 1 hora, la sincronización está caída; el sitio avisa a los clientes pasadas 2 horas.
- **Pruebas:** `pruebas/sql/correr-local.sh` aplica los tres archivos en un Postgres temporal y corre `pruebas/sql/casos.sql`. Nunca correr los casos en producción.
- **Orden por "más pedidos":** lo calcula tu planilla (columna `pedidos`) y el catálogo llega ya ordenado. Los pedidos que se hacen desde el sitio quedan registrados en `pedidos_catalogo`, pero por ahora no cambian ese orden.
- **Productos que salen de la planilla:** quedan con `publicado = false`. No se borran, así que la historia de pedidos se conserva.
- **Volver atrás:** poner `activo: false` en el bloque `SUPABASE` de `config.js`. El sitio vuelve a leer del Apps Script.
