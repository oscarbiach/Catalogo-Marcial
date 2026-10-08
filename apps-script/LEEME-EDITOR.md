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
