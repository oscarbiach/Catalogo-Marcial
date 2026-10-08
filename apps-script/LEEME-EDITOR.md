# Editor de fichas de producto

Ventana dentro de la planilla del catalogo para completar, producto por
producto y viendo sus fotos, la **descripcion**, la **presentacion / peso
aproximado** y las **unidades por caja**.

Archivos: `EditorFichas.gs` (logica) y `EditorFichas.html` (la ventana).

## Que toca y que no

- Escribe solo en las columnas `descripcion`, `presentacion`, `unidades_caja` e `imagenes` (orden de las fotos y cuales quedan)
  de la hoja `Productos`, y solo en la fila del producto que se esta editando.
  Antes de escribir verifica que el `id` de esa fila siga siendo el mismo.
- Quitar una foto la saca de la lista del producto; el archivo sigue en Drive. Nunca
  agrega fotos nuevas ni ids que el producto no tuviera.
- No cambia precios, orden, categorias, formulas ni la estructura.
- Rechaza textos que Sheets convertiria en formula (empiezan con `=`) o en fecha
  (`1/2`), para no romper celdas.
- Primero valida todo y recién después escribe: si algo está mal no se toca ninguna celda.
- Si otra persona cambió el mismo campo mientras editabas, no lo pisa: avisa para recargar.
- Cada cambio queda en la hoja nueva `Historial fichas` (fecha, id, producto,
  campo, antes, despues). Sirve para deshacer. Se puede borrar cuando se quiera.
- Al guardar llama a `invalidarCache()` (ya existe en `Codigo.gs`) para que el
  catalogo publico y la sincronizacion con Supabase lo tomen en la proxima vuelta.

## Instalacion (una vez)

1. Hacer una copia de la planilla: Archivo > Hacer una copia.
2. Abrir el Apps Script del catalogo (Extensiones > Apps Script).
3. `+` junto a Archivos > Script. Nombre: `FichasCodigo`. Pegar `EditorFichas.gs`.
4. `+` > HTML. Nombre exacto: `EditorFichas`. Pegar `EditorFichas.html`.
5. Guardar. Ejecutar `ef_probar`: solo lee y cuenta, no modifica nada.
6. Ejecutar `ef_instalarMenu`. Recargar la planilla: aparece el menu
   "Fichas de producto > Abrir el editor de fichas".

Para quitar el menu: `ef_quitarMenu`. Todas las funciones empiezan con `ef_` para
no chocar con las existentes.

## Uso

- Filtro "Sin descripcion" (por defecto), "Sin presentacion", "Falta algo" o "Todos".
- "Guardar y siguiente" (o Ctrl+Enter). Anterior y Siguiente tambien guardan lo
  que se haya modificado.
- La presentacion y el peso van juntos en un texto libre, por ejemplo
  "Pieza de aprox. 4 kg" o "Caja x 12 u".

## Fotos

- La primera foto es la principal (la que se ve en el catalogo).
- Flechas para mover, arrastrar y soltar, o "Usar esta foto como principal".
- La X pide confirmacion y solo saca la foto de ese producto.
- Se vuelve a escribir en el mismo formato en que ya estaban las fotos en la hoja
  (`ef_probar` muestra el formato detectado).

## Unidad del precio (kg, unidad o caja)

Cada producto puede decir por que unidad es su precio y en que se cuenta el pedido.
Si no se elige ("Automatico") queda el comportamiento anterior.

Pasos (una sola vez):
1. Ejecutar `ef_prepararColumnas`: agrega el titulo `unidad_precio` en la primera
   columna libre de la hoja `Productos` (no toca nada mas).
2. En `Codigo.gs`:
   - en `COLUMNAS`, agregar `'unidad_precio'` al final de la lista;
   - en `despublicar`, agregar `unidadPrecio: p.unidad_precio,` junto a `presentacion`.
3. Elegir la unidad producto por producto en el editor ("El precio es por...").

Del lado de Supabase la columna `unidad_precio` y la sincronizacion ya estan en
`supabase/02-sincronizacion.sql`.
