# Lista de precios en PDF

`ListaPDF.gs` genera un PDF con celdas fijas de la hoja de venta y lo mantiene
al dia en Drive. El archivo es siempre el mismo, asi que el enlace no cambia y
el boton "Ver lista de precios" del catalogo apunta a un enlace fijo.

## Instalacion (una sola vez, en el Apps Script del Spreadsheet)

1. Abrir el Spreadsheet `Precios COSTO - VENTA` > Extensiones > Apps Script.
2. Crear un archivo nuevo (`+` > Script) llamado `ListaPDF` y pegar todo el
   contenido de `ListaPDF.gs`.
3. Completar `CONFIG` arriba: `SPREADSHEET_ID`, `HOJA`, `RANGO` y, si se quiere,
   `CARPETA_ID`.
4. Ejecutar `instalarActivadores` (acepta los permisos de Drive y Sheets).
5. Ejecutar `actualizarListaPDF`. El enlace queda en Ejecuciones/Registros
   (o ejecutar `verEnlace`).
6. Pegar ese enlace en `docs/config.js`, campo `LISTA_PDF`. Con eso el boton de
   la portada pasa a decir "Ver lista de precios" y abre el PDF.

## Como se mantiene al dia

- Cada 5 minutos compara el contenido de las celdas con la ultima version.
  Si cambio algo, regenera el PDF. Detecta cambios hechos a mano, por formula o
  por otro script.
- Ademas se revisa apenas se modifica la planilla (maximo una vez por minuto).

## Cuidados

- El PDF es publico (cualquiera con el enlace): el rango debe tener solo precios
  de venta, ningun costo ni margen.
- Si se cambia `RANGO`, ejecutar `regenerarListaPDF` para forzar el cambio.
- No cambiar `NOMBRE_PDF` ni borrar el archivo: si se borra, se crea otro y el
  enlace cambia.
