# Conectar el catálogo con Supabase

## Estado (07/10/2026)

- Proyecto de Supabase: **Catalago Marcial** (`tdyekqddpchjjiuhglhv`), separado de la app de pedidos.
- Esquema aplicado, con seguridad por filas, y probado con la clave pública.
- **Sincronización automática activa:** cada 10 minutos Supabase lee el catálogo de tu Apps Script (`?action=catalog`) y lo copia a las tablas. Es lo mismo que hace hoy la tarea programada de Insforge, así que **no hay que tocar el Apps Script**. Detalle en `02-sincronizacion.sql`.
- Primera sincronización: 322 productos (269 publicados, 53 ocultos) y 17 datos de configuración.
- `docs/config.js` apunta a este proyecto con `activo: true`. Insforge queda de respaldo.

Para mirar cómo viene la sincronización (en el SQL Editor de Supabase):

```sql
select * from sincronizacion_log order by id desc limit 10;
```

## Pasos

1. **Crear el proyecto.** En supabase.com, un proyecto nuevo solo para el catálogo (no el de la app de pedidos). Anotá la contraseña de la base en un lugar seguro.
2. **Crear las tablas.** Abrí *SQL Editor → New query*, pegá todo `01-catalogo.sql` y tocá *Run*. Al final tiene que mostrar 4 tablas con `seguridad_activada = true`.
3. **Copiar la URL y la clave pública.** En *Project Settings → API*: la *Project URL* y la clave **anon / publishable**. Estas dos sí se pueden pegar en el sitio.
4. **Encender el sitio.** En `docs/config.js`, bloque `SUPABASE`: pegá `URL` y `ANON` y poné `activo: true`.
5. **Cargar los datos.** Correr `02-sincronizacion.sql` en el SQL Editor. Programa la copia automática desde tu Apps Script y no hay que pegar nada en él.
6. **Probar.** Abrí el sitio con la consola del navegador abierta. No debería haber avisos de "Supabase no respondió". Mandá un pedido de prueba y mirá que aparezca en *Table Editor → pedidos_catalogo*.
7. **Apagar Insforge** (`activo: false`) cuando todo esté estable. Se puede dejar de respaldo un tiempo.

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
- **Pedidos de relleno:** cualquiera que conozca la clave pública puede llamar a `registrar_pedido`. La función limita el tamaño y valida los productos, pero no frena a alguien que mande muchos pedidos. Si llegara a pasar, se agrega un límite por tiempo o un control anti-robots.
- **Orden por "más pedidos":** lo calcula tu planilla (columna `pedidos`) y el catálogo llega ya ordenado. Los pedidos que se hacen desde el sitio quedan registrados en `pedidos_catalogo`, pero por ahora no cambian ese orden.
- **Productos que salen de la planilla:** quedan con `publicado = false`. No se borran, así que la historia de pedidos se conserva.
- **Volver atrás:** poner `activo: false` en el bloque `SUPABASE` de `config.js`. El sitio vuelve a leer de Insforge o de Apps Script.
