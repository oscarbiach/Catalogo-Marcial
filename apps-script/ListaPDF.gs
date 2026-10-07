/**
 * Lista de precios en PDF, siempre al dia.
 * ---------------------------------------------------------------------------
 * Toma unas celdas fijas de la hoja de venta, las convierte en PDF y lo deja
 * en una carpeta de Drive con SIEMPRE el mismo archivo: el enlace no cambia,
 * asi el boton "Ver lista de precios" del catalogo apunta a un enlace fijo.
 *
 * Se vuelve a generar solo cuando cambia algo de esas celdas (se compara el
 * contenido, asi que tambien detecta numeros que cambian por formula o por
 * otro script, cosa que el "al editar" comun no ve).
 *
 * USO (una sola vez):
 *   1. Completar la seccion CONFIGURACION de abajo.
 *   2. Ejecutar  probarSinGuardar()  : muestra que celdas se van a usar y NO
 *      crea ni cambia nada.
 *   3. Ejecutar  actualizarListaPDF()  una vez a mano: crea el PDF y deja el
 *      enlace en  Ver > Registros de ejecucion.
 *   4. Ejecutar  instalarActivadores()  para que se mantenga al dia solo.
 *   5. Pasar el enlace al catalogo (config.js, campo LISTA_PDF).
 *
 * SOLO LECTURA: este script NUNCA escribe en la planilla. Baja una copia en
 * texto (CSV) de la hoja, igual que "Archivo > Descargar", y no usa
 * SpreadsheetApp: el appsscript.json que lo acompana NO le da permiso para
 * editar hojas. Lo unico que crea o cambia es el archivo PDF, en Drive, y sus
 * propios datos internos del script.
 *
 * IMPORTANTE: el PDF es PUBLICO (cualquiera con el enlace). El rango tiene que
 * incluir solo precios de venta; nunca costos ni margenes.
 */

// ============================== CONFIGURACION ==============================
var CONFIG = {
  // Archivo de Google Sheets "Precios COSTO - VENTA": el codigo largo de la URL
  // entre /d/ y /edit.
  SPREADSHEET_ID: 'PEGAR_ACA_EL_ID_DEL_SPREADSHEET',

  // Numero de la pestania "Ventas": abrir esa pestania en el navegador y mirar
  // el final de la URL, donde dice  #gid=NUMERO
  GID: 'PEGAR_ACA_EL_NUMERO_GID',

  // Celdas fijas que van al PDF (en formato A1, por ejemplo A1:G200). Dejar '' para toda la hoja.
  RANGO: 'A1:G200',

  // Carpeta de Drive donde queda el PDF (el codigo al final de la URL de la
  // carpeta). Dejar '' para guardarlo en "Mi unidad".
  CARPETA_ID: '',

  // Nombre del archivo. No cambiarlo despues: el enlace se mantiene igual.
  NOMBRE_PDF: 'Lista de Precios Marcial.pdf',

  // Cada cuantos minutos revisar si hubo cambios (valores validos: 1, 5, 10, 15, 30)
  REVISAR_CADA_MINUTOS: 5
};
// ===========================================================================

var PROP_ARCHIVO = 'LISTA_PDF_ARCHIVO_ID';
var PROP_HUELLA = 'LISTA_PDF_HUELLA';

/** Revisa si cambio algo y, si cambio, regenera el PDF. */
function actualizarListaPDF(forzar) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;       // ya hay otra corrida en curso
  try {
    var datos = leerHoja_();
    var huella = huella_(datos.valores);
    var props = PropertiesService.getScriptProperties();

    if (forzar !== true && props.getProperty(PROP_HUELLA) === huella && props.getProperty(PROP_ARCHIVO)) {
      return;                              // nada cambio
    }

    var pdf = exportarPDF_();
    var archivo = guardarPDF_(pdf, props);
    props.setProperty(PROP_HUELLA, huella);
    Logger.log('PDF actualizado: https://drive.google.com/file/d/' + archivo.getId() + '/view');
  } finally {
    lock.releaseLock();
  }
}

/** Para forzar el PDF aunque no haya cambios (por ejemplo, tras cambiar el rango). */
function regenerarListaPDF() {
  actualizarListaPDF(true);
}

/** Muestra el enlace del PDF en el registro. */
function verEnlace() {
  var id = PropertiesService.getScriptProperties().getProperty(PROP_ARCHIVO);
  Logger.log(id ? 'https://drive.google.com/file/d/' + id + '/view' : 'Todavia no se genero el PDF: ejecutar actualizarListaPDF().');
}

/** Crea la revision periodica. No toca la planilla: solo programa este script. */
function instalarActivadores() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'actualizarListaPDF') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('actualizarListaPDF').timeBased().everyMinutes(CONFIG.REVISAR_CADA_MINUTOS).create();
  Logger.log('Listo: se revisa cada ' + CONFIG.REVISAR_CADA_MINUTOS + ' minutos.');
}

/** Para sacar la revision automatica. */
function quitarActivadores() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'actualizarListaPDF') ScriptApp.deleteTrigger(t);
  });
  Logger.log('Revision automatica desactivada.');
}

/**
 * Prueba segura: solo LEE el rango y lo muestra en el registro. No crea el PDF
 * ni cambia nada, ni en la planilla ni en Drive.
 */
function probarSinGuardar() {
  var v = leerHoja_().valores;
  var llenas = v.filter(function (fila) {
    return fila.some(function (c) { return String(c).trim() !== ''; });
  });
  Logger.log((CONFIG.RANGO ? 'Rango: ' + CONFIG.RANGO : 'Toda la hoja') + ' | ' + v.length +
    ' filas (' + llenas.length + ' con datos) x ' + (v[0] ? v[0].length : 0) + ' columnas');
  Logger.log('--- PRIMERAS 10 FILAS CON DATOS ---');
  llenas.slice(0, 10).forEach(function (f) { Logger.log(JSON.stringify(f)); });
  Logger.log('--- ULTIMAS 5 FILAS CON DATOS ---');
  llenas.slice(-5).forEach(function (f) { Logger.log(JSON.stringify(f)); });
}

// ------------------------------- internos ----------------------------------

/** Baja la hoja como CSV (solo lectura) y devuelve los valores tal como se ven. */
function leerHoja_() {
  var url = urlExportacion_('csv');
  var r = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (r.getResponseCode() !== 200) {
    throw new Error('No se pudo leer la planilla (HTTP ' + r.getResponseCode() + '). Revisar SPREADSHEET_ID y GID.');
  }
  return { valores: Utilities.parseCsv(r.getContentText()) };
}

function urlExportacion_(formato) {
  var partes = ['format=' + formato, 'gid=' + CONFIG.GID];
  if (CONFIG.RANGO) partes.push('range=' + encodeURIComponent(CONFIG.RANGO));
  if (formato === 'pdf') {
    partes.push('size=A4', 'portrait=true', 'fitw=true', 'gridlines=false', 'printtitle=false',
      'sheetnames=false', 'pagenum=UNDEFINED',
      'top_margin=0.5', 'bottom_margin=0.5', 'left_margin=0.5', 'right_margin=0.5');
  }
  return 'https://docs.google.com/spreadsheets/d/' + CONFIG.SPREADSHEET_ID + '/export?' + partes.join('&');
}

function huella_(valores) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(valores));
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function exportarPDF_() {
  var respuesta = UrlFetchApp.fetch(urlExportacion_('pdf'), {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (respuesta.getResponseCode() !== 200) {
    throw new Error('No se pudo exportar el PDF (HTTP ' + respuesta.getResponseCode() + ').');
  }
  return respuesta.getBlob().setName(CONFIG.NOMBRE_PDF);
}

/** Crea el archivo la primera vez y despues le cambia el contenido, sin cambiar el enlace. */
function guardarPDF_(pdf, props) {
  var id = props.getProperty(PROP_ARCHIVO);
  var archivo = null;
  if (id) {
    try { archivo = DriveApp.getFileById(id); if (archivo.isTrashed()) archivo = null; } catch (e) { archivo = null; }
  }

  if (!archivo) {
    var carpeta = CONFIG.CARPETA_ID ? DriveApp.getFolderById(CONFIG.CARPETA_ID) : DriveApp.getRootFolder();
    archivo = carpeta.createFile(pdf);
    archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    props.setProperty(PROP_ARCHIVO, archivo.getId());
    return archivo;
  }

  var r = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files/' + archivo.getId() + '?uploadType=media', {
    method: 'patch',
    contentType: 'application/pdf',
    payload: pdf.getBytes(),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (r.getResponseCode() !== 200) {
    throw new Error('No se pudo actualizar el PDF en Drive (HTTP ' + r.getResponseCode() + ').');
  }
  return archivo;
}
