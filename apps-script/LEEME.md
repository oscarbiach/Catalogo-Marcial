# Lista de precios en PDF

`ListaPDF.gs` genera un PDF con celdas fijas de la hoja de venta y lo mantiene
al dia en Drive. El archivo es siempre el mismo, asi que el enlace no cambia y
el boton "Ver lista de precios" del catalogo apunta a un enlace fijo.

## Garantia de solo lectura

El script **no escribe nunca en la planilla**: solo lee los valores visibles del
rango con la API de consulta de Google Sheets. Lo unico que crea o cambia es el PDF en Drive.
Ademas `appsscript.json` pide permiso `spreadsheets.readonly`: Google rechaza
cualquier intento de escribir en una hoja. No usa `setValue`, `clear`,
`insert`, `delete`, `sort` ni nada que modifique celdas, formulas o formatos.

## Antes de empezar

1. Hacer una copia de seguridad de la planilla: Archivo > Hacer una copia.
2. Crear un proyecto de Apps Script **nuevo y aparte** (script.google.com >
   Nuevo proyecto), no dentro de la planilla ni del Apps Script del catalogo:
   asi no se toca ningun script existente.

## Instalacion (una sola vez)

1. En el proyecto nuevo, pegar `ListaPDF.gs` en `Codigo.gs`.
2. Configuracion del proyecto (engranaje) > tildar "Mostrar el archivo de
   manifiesto appsscript.json", abrirlo y reemplazar su contenido por el de
   `appsscript.json` de esta carpeta.
3. Completar `CONFIG` arriba: `SPREADSHEET_ID`, `HOJA`, `RANGO` y, si se quiere,
   `CARPETA_ID`.
4. Ejecutar `probarSinGuardar`: solo muestra el rango en el registro, no crea ni
   cambia nada. Revisar que sean las celdas correctas y que no haya costos.
5. Ejecutar `actualizarListaPDF`. Crea el PDF y deja el enlace en el registro
   (o ejecutar `verEnlace`).
6. Ejecutar `instalarActivadores` para que se mantenga al dia solo.
7. Pegar el enlace en `docs/config.js`, campo `LISTA_PDF`. Con eso el boton de
   la portada pasa a decir "Ver lista de precios" y abre el PDF.

## Como se mantiene al dia

- Cada 5 minutos (configurable) compara el contenido de las celdas con la ultima
  version. Si cambio algo, regenera el PDF. Detecta cambios hechos a mano, por
  formula o por otro script. Para desactivarlo: `quitarActivadores`.

## Cuidados

- El PDF es publico (cualquiera con el enlace): el rango debe tener solo precios
  de venta, ningun costo ni margen.
- Si se cambia `RANGO`, ejecutar `regenerarListaPDF` para forzar el cambio.
- No cambiar `NOMBRE_PDF` ni borrar el archivo: si se borra, se crea otro y el
  enlace cambia.
