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
 *   2. Ejecutar  instalarActivadores()  y aceptar los permisos.
 *   3. Ejecutar  actualizarListaPDF()  una vez a mano: crea el PDF y deja el
 *      enlace en  Ver > Registros de ejecucion.
 *   4. Pasar ese enlace al catalogo (config.js, campo LISTA_PDF).
 *
 * IMPORTANTE: el PDF es PUBLICO (cualquiera con el enlace). El rango tiene que
 * incluir solo precios de venta; nunca costos ni margenes.
 */

// ============================== CONFIGURACION ==============================
var CONFIG = {
  // Archivo de Google Sheets "Precios COSTO - VENTA": el codigo largo de la URL
  // entre /d/ y /edit.
  SPREADSHEET_ID: 'PEGAR_ACA_EL_ID_DEL_SPREADSHEET',

  // Nombre exacto de la hoja con los precios de venta
  HOJA: 'Ventas',

  // Celdas fijas que van al PDF (en formato A1). Dejar '' para toda la hoja.
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
    var hoja = obtenerHoja_();
    var rango = CONFIG.RANGO ? hoja.getRange(CONFIG.RANGO) : hoja.getDataRange();
    var huella = huella_(rango.getDisplayValues());
    var props = PropertiesService.getScriptProperties();

    if (forzar !== true && props.getProperty(PROP_HUELLA) === huella && props.getProperty(PROP_ARCHIVO)) {
      return;                              // nada cambio
    }

    var pdf = exportarPDF_(hoja, rango);
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

/** Crea los activadores: revision periodica y revision al editar. */
function instalarActivadores() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'actualizarListaPDF' || f === 'alEditar_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('actualizarListaPDF').timeBased().everyMinutes(CONFIG.REVISAR_CADA_MINUTOS).create();
  ScriptApp.newTrigger('alEditar_').forSpreadsheet(CONFIG.SPREADSHEET_ID).onChange().create();
  Logger.log('Activadores instalados. Ahora ejecutar actualizarListaPDF() una vez.');
}

/** Al cambiar la planilla se revisa enseguida (con tope de una vez por minuto). */
function alEditar_() {
  var props = PropertiesService.getScriptProperties();
  var ultima = Number(props.getProperty('LISTA_PDF_ULTIMA_REVISION') || 0);
  if (Date.now() - ultima < 60000) return;     // la revision periodica lo toma despues
  props.setProperty('LISTA_PDF_ULTIMA_REVISION', String(Date.now()));
  actualizarListaPDF();
}

// ------------------------------- internos ----------------------------------

function obtenerHoja_() {
  var libro = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var hoja = libro.getSheetByName(CONFIG.HOJA);
  if (!hoja) throw new Error('No existe la hoja "' + CONFIG.HOJA + '".');
  return hoja;
}

function huella_(valores) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(valores));
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function exportarPDF_(hoja, rango) {
  var a1 = rango.getA1Notation();
  var url = 'https://docs.google.com/spreadsheets/d/' + CONFIG.SPREADSHEET_ID + '/export?' + [
    'format=pdf',
    'gid=' + hoja.getSheetId(),
    'range=' + encodeURIComponent(a1),
    'size=A4',
    'portrait=true',
    'fitw=true',                 // ajustar al ancho de la hoja
    'gridlines=false',
    'printtitle=false',
    'sheetnames=false',
    'pagenum=UNDEFINED',
    'top_margin=0.5', 'bottom_margin=0.5', 'left_margin=0.5', 'right_margin=0.5'
  ].join('&');

  var respuesta = UrlFetchApp.fetch(url, {
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
