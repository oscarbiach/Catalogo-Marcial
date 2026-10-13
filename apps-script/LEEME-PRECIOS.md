# Precios: una sola lista para la página y el PDF

Desde el 13/10/2026 la página y el PDF del botón "Ver lista de precios" salen
de la misma planilla: **Precios Publicos**. Tiene solo precios de venta, sin
costos ni márgenes.

```
Precios Publicos ──► PreciosPublicos.gs (catálogo) ──► hoja Productos ──► Supabase ──► página
        └──────────► ListaPDF.gs (proyecto aparte) ──► PDF en Drive ──► botón "Ver lista de precios"
```

Para cambiar un precio, se cambia en **Precios Publicos**. El PDF se regenera
en unos 5 minutos y la página se actualiza en unos 25 minutos: 15 de la
revisión de precios más 10 de la copia a Supabase.

## Corte: hasta dónde se lee la lista

La página y el PDF leen **"Precios Publicos" hasta la fila "Tripa Gorda - La
Morena", sin incluirla**. De ahí para abajo no se toma nada (pedido del
13/10/2026).
- La fila se busca **por nombre**, así sigue sirviendo aunque se agreguen
  filas arriba. Mayúsculas, tildes y espacios de más no cuentan.
- **Si esa fila se borra o se le cambia el nombre**, los dos scripts se frenan
  y avisan en el registro; no toman de más. El PDF queda en su última versión
  y la página no cambia ningún precio. Para mover el corte, cambiar
  `CORTAR_DESDE` en los dos scripts: en `PP` (PreciosPublicos.gs) y en
  `CONFIG` (ListaPDF.gs).

## 1. Página: `PreciosPublicos.gs`

Va en el proyecto de Apps Script **del catálogo**, el mismo que tiene
`Codigo.gs` y `CajaCerrada.gs`.

1. Archivo nuevo de script llamado `PreciosPublicos`. Pegar el contenido de
   `PreciosPublicos.gs` y guardar.
2. Ejecutar `pp_simular`. No escribe nada: el registro muestra qué precios
   cambiarían, cuáles quedan para revisar y qué productos no encontró en la
   lista.
3. Ejecutar `pp_aplicar`. Escribe los precios y los anota en "Historial
   fichas". Los cambios de más del 50% **no** se aplican: quedan listados.
   Si están bien, ejecutar `pp_aplicarTodo`.
4. Ejecutar `pp_instalar` para que revise sola cada 15 minutos. Se saca con
   `pp_quitar`.

Cada producto se busca **por nombre**, nunca por posición:
- Mayúsculas, tildes y signos no cuentan.
- También sirven nombre + " - " + marca, nombre + " - " + descripción y el
  nombre sin la marca adelante.

Si un producto tiene en la lista un nombre distinto, escribir el nombre exacto
de la lista en la columna **nombre_lista** de Productos. `pp_aplicar` la crea al
final de la hoja.

La columna del precio sale de `unidad_precio`:

| `unidad_precio` | Columna de la lista |
|---|---|
| kg | KILO |
| unidad | UNIDAD |
| caja | CAJA |

Si esa celda está vacía y la fila tiene un solo precio, se usa ese. En la lista
hay productos por unidad con el precio escrito bajo KILO. Un precio que solo
está en CAJA nunca se toma como precio por unidad.

## 2. PDF: `ListaPDF.gs`

Va en su proyecto aparte, el que ya genera el PDF. Solo cambia la sección
`CONFIG`:

```js
SPREADSHEET_ID: '1H9JxYDK4FEBnCGfpImrr--rMzoRliwkFea2Jxp-ZMWU',
GID: '0',
RANGO: '',
CORTAR_DESDE: 'Tripa Gorda - La Morena',
```

Desde el 13/10/2026 el archivo además calcula el rango del PDF a partir del
corte. Conviene pegar `ListaPDF.gs` entero, no solo estas líneas.

Después:
1. Ejecutar `probarSinGuardar` y revisar que muestre la lista de venta.
2. Ejecutar `regenerarListaPDF`.
3. Ejecutar `verEnlace`. Si el enlace es distinto del de `docs/config.js`
   (`LISTA_PDF`), hay que actualizarlo ahí.
