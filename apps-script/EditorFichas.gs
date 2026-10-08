/**
 * Editor de fichas de producto
 * ---------------------------------------------------------------------------
 * Una ventana dentro de la planilla del catalogo para completar, producto por
 * producto y viendo sus fotos, la descripcion, la presentacion y las unidades
 * por caja. Se abre desde el menu "Fichas de producto".
 *
 * QUE TOCA Y QUE NO
 *  - Escribe SOLO en cuatro columnas de la hoja Productos: descripcion,
 *    presentacion, unidades_caja e imagenes (el orden de las fotos y cuales
 *    quedan), y solo en la fila del producto que se esta editando (verifica que
 *    el id coincida antes de escribir).
 *  - Quitar una foto la saca de la lista del producto; el archivo sigue en Drive.
 *    Nunca se agregan fotos nuevas ni ids que no estuvieran ya en el producto.
 *  - No cambia precios, orden, categorias, formulas ni la estructura.
 *  - Cada cambio queda anotado en una hoja nueva "Historial fichas" (fecha,
 *    producto, campo, valor anterior y nuevo): sirve para deshacer. Se puede
 *    borrar esa hoja cuando quieras.
 *  - Despues de guardar vacia el cache del catalogo para que el sitio y la
 *    sincronizacion lo tomen en la proxima vuelta.
 *
 * INSTALACION: ver apps-script/LEEME-EDITOR.md
 *  - Todas las funciones empiezan con ef_ para no chocar con las existentes.
 */

var EF = {
  HOJA: 'Productos',
  HISTORIAL: 'Historial fichas',
  CAMPOS: ['descripcion', 'presentacion', 'unidades_caja'],
  UNIDADES_PRECIO: ['', 'kg', 'unidad', 'caja'],   // '' = automatico
  MAX_DESCRIPCION: 800,
  MAX_PRESENTACION: 120,
  MAX_NOMBRE: 150
};

// ------------------------------- menu --------------------------------------

/** Se corre UNA vez: crea el activador que arma el menu cada vez que se abre la planilla. */
function ef_instalarMenu() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'ef_crearMenu') ScriptApp.deleteTrigger(t);
  });
  var planilla = ef_planilla_();
  ScriptApp.newTrigger('ef_crearMenu').forSpreadsheet(planilla).onOpen().create();
  ef_crearMenu();
  Logger.log('Listo. Recarga la planilla (F5): aparece el menu "Fichas de producto".');
}

function ef_quitarMenu() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'ef_crearMenu') ScriptApp.deleteTrigger(t);
  });
  Logger.log('Menu desactivado.');
}

function ef_crearMenu() {
  SpreadsheetApp.getUi()
    .createMenu('Fichas de producto')
    .addItem('Abrir el editor de fichas', 'ef_abrir')
    .addToUi();
}

function ef_abrir() {
  var html = HtmlService.createHtmlOutputFromFile('EditorFichas')
    .setWidth(1100)
    .setHeight(760);
  SpreadsheetApp.getUi().showModalDialog(html, 'Editor de fichas de producto');
}

// ------------------------------ lectura ------------------------------------

function ef_planilla_() {
  var activa = SpreadsheetApp.getActiveSpreadsheet();
  if (activa) return activa;
  var id = PropertiesService.getScriptProperties().getProperty('PLANILLA_ID');
  if (id) return SpreadsheetApp.openById(id);
  throw new Error('Este script no esta unido a la planilla del catalogo.');
}

function ef_hoja_() {
  var hoja = ef_planilla_().getSheetByName(EF.HOJA);
  if (!hoja) throw new Error('No existe la hoja "' + EF.HOJA + '".');
  return hoja;
}

/** Posicion (1, 2, 3...) de cada columna segun su titulo, sin depender del orden. */
function ef_columnas_(hoja) {
  var titulos = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  var mapa = {};
  titulos.forEach(function (t, i) {
    var clave = String(t).trim().toLowerCase();
    if (clave && !mapa[clave]) mapa[clave] = i + 1;
  });
  return mapa;
}

function ef_verdadero_(v) {
  if (v === true) return true;
  var s = String(v).trim().toLowerCase();
  return s === 'true' || s === 'si' || s === 'sí' || s === '1' || s === 'x' || s === 'verdadero';
}

/** Saca los ids de Drive de la celda de imagenes, sea lista JSON, separada por comas o enlaces. */
function ef_idsImagen_(valor) {
  if (valor === '' || valor === null || valor === undefined) return [];
  var texto = String(valor).trim();
  if (texto.charAt(0) === '[') {
    try {
      return JSON.parse(texto).map(String).filter(Boolean);
    } catch (e) { /* sigue con el metodo general */ }
  }
  return (texto.match(/[-\w]{25,}/g) || []);
}

/**
 * Se corre UNA vez: agrega a la hoja Productos la columna "unidad_precio" (por que
 * unidad es el precio: kg, unidad o caja). Solo escribe el titulo en la primera
 * columna libre, a la derecha de todas las que ya existen. No toca nada mas.
 */
function ef_prepararColumnas() {
  var hoja = ef_hoja_();
  var col = ef_columnas_(hoja);
  if (col.unidad_precio) {
    Logger.log('La columna unidad_precio ya existe (columna ' + col.unidad_precio + '). No se hizo nada.');
    return;
  }
  var titulos = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  var ultimaConTitulo = 0;
  titulos.forEach(function (t, i) { if (String(t).trim() !== '') ultimaConTitulo = i + 1; });
  var nueva = ultimaConTitulo + 1;
  hoja.getRange(1, nueva).setValue('unidad_precio');
  Logger.log('Listo: se agrego el titulo "unidad_precio" en la columna ' + nueva + ' de la hoja ' + EF.HOJA + '.');
}

/**
 * Mira como estan escritas las fotos en toda la columna imagenes (lista JSON,
 * separadas por coma, por punto y coma o una por linea) para volver a escribirlas
 * exactamente igual.
 */
function ef_formatoImagenes_(valoresColumna) {
  var cuenta = { json: 0, nl: 0, semi: 0, comaEsp: 0, coma: 0 };
  valoresColumna.forEach(function (v) {
    var t = String(v === null || v === undefined ? '' : v).trim();
    if (!t) return;
    if (t.charAt(0) === '[') cuenta.json++;
    else if (t.indexOf('\n') > -1) cuenta.nl++;
    else if (t.indexOf(';') > -1) cuenta.semi++;
    else if (/,\s/.test(t)) cuenta.comaEsp++;
    else if (t.indexOf(',') > -1) cuenta.coma++;
  });
  var mejor = 'coma', max = -1;
  ['json', 'nl', 'semi', 'comaEsp', 'coma'].forEach(function (k) {
    if (cuenta[k] > max) { max = cuenta[k]; mejor = k; }
  });
  return max <= 0 ? 'coma' : mejor;
}

function ef_serializarImagenes_(ids, formato) {
  if (formato === 'json') return JSON.stringify(ids);
  var sep = { nl: '\n', semi: ';', comaEsp: ', ', coma: ',' }[formato] || ',';
  return ids.join(sep);
}

/** Todos los productos, con lo necesario para editarlos. No modifica nada. */
function ef_listar() {
  var hoja = ef_hoja_();
  var col = ef_columnas_(hoja);
  ['id', 'nombre', 'descripcion', 'presentacion', 'unidades_caja'].forEach(function (k) {
    if (!col[k]) throw new Error('En la hoja "' + EF.HOJA + '" falta la columna "' + k + '".');
  });
  var ultima = hoja.getLastRow();
  if (ultima < 2) return { productos: [], categorias: [], tieneColumnaUnidad: !!col.unidad_precio };

  var valores = hoja.getRange(2, 1, ultima - 1, hoja.getLastColumn()).getValues();
  var dato = function (fila, k) { return col[k] ? fila[col[k] - 1] : ''; };
  var categorias = {};

  var productos = [];
  valores.forEach(function (fila, i) {
    var id = String(dato(fila, 'id')).trim();
    if (!id) return;
    var cat = String(dato(fila, 'categoria') || '').trim();
    if (cat) categorias[cat] = true;
    productos.push({
      fila: i + 2,
      id: id,
      sku: String(dato(fila, 'sku') || ''),
      nombre: String(dato(fila, 'nombre') || ''),
      categoria: cat,
      marca: String(dato(fila, 'marca') || ''),
      precio: dato(fila, 'precio') === '' ? null : Number(dato(fila, 'precio')),
      descripcion: String(dato(fila, 'descripcion') || ''),
      presentacion: String(dato(fila, 'presentacion') || ''),
      unidadesCaja: dato(fila, 'unidades_caja') === '' ? '' : Number(dato(fila, 'unidades_caja')),
      unidadPrecio: col.unidad_precio ? String(dato(fila, 'unidad_precio') || '').trim().toLowerCase() : '',
      imagenes: ef_idsImagen_(dato(fila, 'imagenes')),
      activo: col.activo ? ef_verdadero_(dato(fila, 'activo')) : true
    });
  });

  return { productos: productos, categorias: Object.keys(categorias).sort(), tieneColumnaUnidad: !!col.unidad_precio };
}

/** Prueba segura: solo lee y cuenta. Sirve para revisar que todo este bien antes de usar el editor. */
function ef_probar() {
  var r = ef_listar();
  var p = r.productos;
  var sinDesc = p.filter(function (x) { return !x.descripcion.trim(); }).length;
  var sinPres = p.filter(function (x) { return !x.presentacion.trim(); }).length;
  var sinFoto = p.filter(function (x) { return !x.imagenes.length; }).length;
  Logger.log('Productos: ' + p.length + ' | sin descripcion: ' + sinDesc + ' | sin presentacion: ' + sinPres + ' | sin foto: ' + sinFoto);
  Logger.log('Primer producto: ' + JSON.stringify(p[0]));
  var hoja = ef_hoja_(), col = ef_columnas_(hoja);
  if (col.imagenes && hoja.getLastRow() > 1) {
    var crudo = hoja.getRange(2, col.imagenes, hoja.getLastRow() - 1, 1).getValues().map(function (f) { return f[0]; });
    var muestra = crudo.filter(function (v) { return String(v).trim() !== ''; })[0];
    Logger.log('Formato de las fotos: ' + ef_formatoImagenes_(crudo) + ' | ejemplo: ' + String(muestra).slice(0, 120));
  }
  Logger.log('Columna unidad_precio: ' + (col.unidad_precio ? 'existe (columna ' + col.unidad_precio + ')' : 'NO existe todavia: ejecutar ef_prepararColumnas'));
  Logger.log('No se modifico nada.');
}

/**
 * Foto de un producto como imagen incrustada. Se pide desde el servidor porque
 * dentro de esta ventana el navegador no siempre deja cargar fotos de Drive.
 */
function ef_foto(id, ancho) {
  try {
    var r = UrlFetchApp.fetch('https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w' + (ancho || 700), {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) return null;
    var blob = r.getBlob();
    return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
  } catch (e) {
    return null;
  }
}

// ------------------------------ escritura ----------------------------------

function ef_texto_(v, max) {
  return String(v === null || v === undefined ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, max);
}

/**
 * Guarda los tres campos de UN producto. Antes de escribir comprueba que en esa
 * fila siga estando el mismo id: si alguien reordeno la hoja mientras tanto, no
 * escribe y avisa.
 */
function ef_guardar(fila, id, datos) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('La planilla esta ocupada, proba de nuevo en unos segundos.');
  try {
    var hoja = ef_hoja_();
    var col = ef_columnas_(hoja);
    fila = Number(fila);
    if (!fila || fila < 2 || fila > hoja.getLastRow()) throw new Error('La fila ya no existe. Recarga el editor.');

    var idEnHoja = String(hoja.getRange(fila, col.id).getValue()).trim();
    if (idEnHoja !== String(id).trim()) {
      throw new Error('La hoja cambio mientras editabas (el producto ya no esta en esa fila). Cerra y volve a abrir el editor.');
    }

    var nuevos = {
      descripcion: ef_texto_(datos.descripcion, EF.MAX_DESCRIPCION),
      presentacion: ef_texto_(datos.presentacion, EF.MAX_PRESENTACION),
      unidades_caja: ''
    };
    // Google Sheets convierte en formula un texto que empieza con "=" y en fecha
    // algo como "1/2": se frena antes de escribir para no romper la celda.
    ['descripcion', 'presentacion'].forEach(function (campo) {
      var t = nuevos[campo];
      if (t.charAt(0) === '=') throw new Error('El texto de "' + campo + '" no puede empezar con "=".');
      if (/^\d{1,2}[\/\-]\d{1,2}([\/\-]\d{1,4})?$/.test(t)) {
        throw new Error('"' + t + '" se leeria como una fecha. Agregale una palabra, por ejemplo "' + t + ' pieza".');
      }
    });
    var uc = String(datos.unidadesCaja === null || datos.unidadesCaja === undefined ? '' : datos.unidadesCaja).trim();
    if (uc !== '') {
      var n = Number(uc);
      if (!isFinite(n) || n < 0 || Math.floor(n) !== n) throw new Error('Las unidades por caja tienen que ser un numero entero.');
      nuevos.unidades_caja = n;
    }

    var nombre = String(hoja.getRange(fila, col.nombre).getValue());
    var cambios = [];

    // Nombre (opcional): no vacio, sin "=" ni forma de fecha al inicio
    if (datos.nombre !== undefined && datos.nombre !== null) {
      var nuevoNombre = ef_texto_(datos.nombre, EF.MAX_NOMBRE).replace(/\s*\n\s*/g, ' ');
      if (!nuevoNombre) throw new Error('El nombre no puede quedar vacio.');
      if (nuevoNombre.charAt(0) === '=') throw new Error('El nombre no puede empezar con "=".');
      if (/^\d{1,2}[\/\-]\d{1,2}([\/\-]\d{1,4})?$/.test(nuevoNombre)) throw new Error('El nombre se leeria como una fecha. Agregale una palabra.');
      if (nuevoNombre !== nombre.trim()) {
        hoja.getRange(fila, col.nombre).setValue(nuevoNombre);
        cambios.push([new Date(), String(id), nombre, 'nombre', nombre, nuevoNombre]);
      }
    }

    // Unidad del precio: kg, unidad o caja ('' = automatico)
    if (datos.unidadPrecio !== undefined && datos.unidadPrecio !== null) {
      var unidad = String(datos.unidadPrecio).trim().toLowerCase();
      if (EF.UNIDADES_PRECIO.indexOf(unidad) === -1) throw new Error('La unidad del precio tiene que ser kg, unidad o caja.');
      if (!col.unidad_precio) throw new Error('Falta la columna "unidad_precio" en la hoja. Ejecuta ef_prepararColumnas una sola vez desde el Apps Script.');
      var celdaUnidad = hoja.getRange(fila, col.unidad_precio);
      var unidadAntes = String(celdaUnidad.getValue() || '').trim().toLowerCase();
      if (unidadAntes !== unidad) {
        celdaUnidad.setValue(unidad);
        cambios.push([new Date(), String(id), nombre, 'unidad_precio', unidadAntes, unidad]);
      }
    }

    // Fotos: solo reordenar o quitar las que el producto ya tiene. Nunca agregar.
    if (datos.imagenes && col.imagenes) {
      var celdaFotos = hoja.getRange(fila, col.imagenes);
      var fotosAntes = celdaFotos.getValue();
      var idsAntes = ef_idsImagen_(fotosAntes);
      var idsNuevos = (datos.imagenes || []).map(String);
      var vistos = {};
      idsNuevos.forEach(function (x) {
        if (idsAntes.indexOf(x) === -1) throw new Error('Una de las fotos no pertenece a este producto. Recarga el editor.');
        if (vistos[x]) throw new Error('Hay una foto repetida. Recarga el editor.');
        vistos[x] = true;
      });
      if (idsNuevos.join('|') !== idsAntes.join('|')) {
        var formato = ef_formatoImagenes_(hoja.getRange(2, col.imagenes, hoja.getLastRow() - 1, 1).getValues().map(function (f) { return f[0]; }));
        var texto = ef_serializarImagenes_(idsNuevos, formato);
        // Comprobacion: lo que se va a escribir tiene que leerse igual que se leyo
        if (ef_idsImagen_(texto).join('|') !== idsNuevos.join('|')) throw new Error('No se pudo guardar el orden de las fotos con el formato de la hoja.');
        celdaFotos.setValue(texto);
        cambios.push([new Date(), String(id), nombre, 'imagenes', String(fotosAntes), texto]);
      }
    }

    EF.CAMPOS.forEach(function (campo) {
      var celda = hoja.getRange(fila, col[campo]);
      var antes = celda.getValue();
      var igual = String(antes === null || antes === undefined ? '' : antes).trim() === String(nuevos[campo]).trim();
      if (igual) return;
      celda.setValue(nuevos[campo]);
      cambios.push([new Date(), String(id), nombre, campo, String(antes), String(nuevos[campo])]);
    });

    if (cambios.length) ef_anotar_(cambios);
    if (cambios.length && typeof invalidarCache === 'function') invalidarCache();
    return { cambios: cambios.length };
  } finally {
    lock.releaseLock();
  }
}

/** Agrega los cambios al final de la hoja "Historial fichas" (la crea la primera vez). */
function ef_anotar_(filas) {
  var planilla = ef_planilla_();
  var hoja = planilla.getSheetByName(EF.HISTORIAL);
  if (!hoja) {
    hoja = planilla.insertSheet(EF.HISTORIAL);
    hoja.getRange(1, 1, 1, 6).setValues([['fecha', 'id', 'producto', 'campo', 'antes', 'despues']]).setFontWeight('bold');
    hoja.setFrozenRows(1);
    // La hoja de historial va al final y no se pone al frente.
    planilla.setActiveSheet(planilla.getSheetByName(EF.HOJA) || planilla.getSheets()[0]);
  }
  hoja.getRange(hoja.getLastRow() + 1, 1, filas.length, 6).setValues(filas);
}


// ------------------- hormas: presentacion y descripcion en bloque ------------
// Para los quesos que se venden por horma. Solo toca, en esas filas:
//   presentacion  -> "Por horma"
//   unidad_precio -> "kg"  (solo si estaba vacia: el precio sigue siendo por kilo)
//   descripcion   -> "Horma de kg aprox."  (solo si estaba vacia: no pisa nada)
// No toca precios ni nombres. Cada cambio queda en "Historial fichas".
var EF_HORMAS = [
  '19', '20', '21', '23', '24', '25', '26', '27', '28',                 // Don Solano
  '35', '36',                                                           // Maciaense
  '38', '40', '42', '43', '45', '47', '53', '55', '57', '59', '60',     // Tremblay
  '61', '62', '63', '64', '66', '67',
  '234', '235', '236', '237', '238', '239',       // Armando
  '240', '241', '243', '244', '245', '246'
];

function ef_hormas_(aplicar) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('La planilla esta ocupada, proba de nuevo.');
  try {
    var hoja = ef_hoja_(), col = ef_columnas_(hoja);
    ['id', 'nombre', 'presentacion', 'descripcion', 'unidad_precio'].forEach(function (k) {
      if (!col[k]) throw new Error('Falta la columna "' + k + '". Si es unidad_precio, ejecuta ef_prepararColumnas.');
    });
    var n = hoja.getLastRow() - 1;
    var leer = function (k) { return hoja.getRange(2, col[k], n, 1).getValues().map(function (f) { return String(f[0] === null ? '' : f[0]).trim(); }); };
    var ids = leer('id'), nombres = leer('nombre'), pres = leer('presentacion'), desc = leer('descripcion'), uni = leer('unidad_precio');
    var cambios = [], lineas = [], tocados = 0, noEncontrados = [];
    var ahora = new Date();
    EF_HORMAS.forEach(function (id) {
      var i = ids.indexOf(id);
      if (i === -1) { noEncontrados.push(id); return; }
      var fila = i + 2, hizo = [];
      if (pres[i] !== 'Por horma') {
        if (aplicar) hoja.getRange(fila, col.presentacion).setValue('Por horma');
        cambios.push([ahora, id, nombres[i], 'presentacion', pres[i], 'Por horma']); hizo.push('presentacion');
      }
      if (uni[i] === '') {
        if (aplicar) hoja.getRange(fila, col.unidad_precio).setValue('kg');
        cambios.push([ahora, id, nombres[i], 'unidad_precio', '', 'kg']); hizo.push('unidad kg');
      }
      if (desc[i] === '') {
        if (aplicar) hoja.getRange(fila, col.descripcion).setValue('Horma de kg aprox.');
        cambios.push([ahora, id, nombres[i], 'descripcion', '', 'Horma de kg aprox.']); hizo.push('descripcion');
      }
      if (hizo.length) { tocados++; lineas.push('  ' + nombres[i] + ' -> ' + hizo.join(', ')); }
    });
    if (aplicar && cambios.length) {
      ef_anotar_(cambios);
      if (typeof invalidarCache === 'function') invalidarCache();
    }
    Logger.log((aplicar ? 'APLICADO' : 'SIMULACION (no se escribio nada)') + ': ' + tocados + ' producto(s) de ' + EF_HORMAS.length + '.\n' +
      lineas.join('\n') + (noEncontrados.length ? '\nNo encontrados (ids): ' + noEncontrados.join(', ') : ''));
  } finally {
    lock.releaseLock();
  }
}
function ef_hormas_simular() { ef_hormas_(false); }
function ef_hormas_aplicar() { ef_hormas_(true); }


// ------------------- Kalis (panes) y Marcial: ajuste puntual -----------------
// Pone KALIS adelante del nombre de los 6 panes Kalis, deja 48 panes por caja en
// los de 10 cm y 28 en los XL de 12 cm (nombre, presentacion y unidades por
// caja), y oculta los panes de marca Marcial (activo = no). No toca precios.
// Primero ef_kalis_simular (no escribe nada), despues ef_kalis_aplicar.
var EF_KALIS = {
  '214': { nombre: 'KALIS Liso Clasico (10cm) x 48u', unidades: 48, presentacion: 'Caja de 48 panes' },
  '211': { nombre: 'KALIS Liso Golden (10cm) x 48u', unidades: 48, presentacion: 'Caja de 48 panes' },
  '215': { nombre: 'KALIS Max Clasico (10cm) x 48u', unidades: 48, presentacion: 'Caja de 48 panes' },
  '212': { nombre: 'KALIS Max Golden (10cm) x 48u', unidades: 48, presentacion: 'Caja de 48 panes' },
  '216': { nombre: 'KALIS Liso XL Clasico (12cm) x 28u', unidades: 28, presentacion: 'Caja de 28 panes' },
  '213': { nombre: 'KALIS Liso XL Golden (12cm) x 28u', unidades: 28, presentacion: 'Caja de 28 panes' }
};
var EF_OCULTAR = ['208', '209', '210'];   // panes Marcial

/** Como se escribe "inactivo" en la hoja, imitando lo que ya hay en la columna activo. */
function ef_inactivo_(actual) {
  if (actual === true || actual === false) return false;
  var t = String(actual).trim();
  if (/^true$/i.test(t)) return 'FALSE';
  if (/^verdadero$/i.test(t)) return 'FALSO';
  if (/^s[ií]$/i.test(t)) return t === t.toUpperCase() ? 'NO' : (t === t.toLowerCase() ? 'no' : 'No');
  if (t === '1') return '0';
  return false;
}

function ef_kalis_(aplicar) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('La planilla esta ocupada, proba de nuevo.');
  try {
    var hoja = ef_hoja_(), col = ef_columnas_(hoja);
    ['id', 'nombre', 'presentacion', 'unidades_caja', 'activo'].forEach(function (k) {
      if (!col[k]) throw new Error('Falta la columna "' + k + '".');
    });
    var n = hoja.getLastRow() - 1;
    var leer = function (k) { return hoja.getRange(2, col[k], n, 1).getValues().map(function (f) { return f[0]; }); };
    var ids = leer('id').map(function (v) { return String(v).trim(); });
    var nombres = leer('nombre'), pres = leer('presentacion'), uni = leer('unidades_caja'), act = leer('activo');
    var cambios = [], lineas = [], ahora = new Date(), faltan = [];

    var poner = function (i, campo, antes, despues, texto) {
      if (String(antes).trim() === String(despues).trim()) return;
      if (aplicar) hoja.getRange(i + 2, col[campo]).setValue(despues);
      cambios.push([ahora, ids[i], String(nombres[i]), campo, String(antes), String(despues)]);
      lineas.push('  ' + nombres[i] + ' -> ' + texto);
    };

    Object.keys(EF_KALIS).forEach(function (id) {
      var i = ids.indexOf(id);
      if (i === -1) { faltan.push(id); return; }
      var c = EF_KALIS[id];
      poner(i, 'nombre', nombres[i], c.nombre, 'nombre: ' + c.nombre);
      poner(i, 'unidades_caja', uni[i], c.unidades, 'unidades por caja: ' + c.unidades);
      poner(i, 'presentacion', pres[i], c.presentacion, 'presentacion: ' + c.presentacion);
    });
    EF_OCULTAR.forEach(function (id) {
      var i = ids.indexOf(id);
      if (i === -1) { faltan.push(id); return; }
      if (ef_verdadero_(act[i])) poner(i, 'activo', act[i], ef_inactivo_(act[i]), 'se oculta (activo = no)');
    });

    if (aplicar && cambios.length) {
      ef_anotar_(cambios);
      if (typeof invalidarCache === 'function') invalidarCache();
    }
    Logger.log((aplicar ? 'APLICADO' : 'SIMULACION (no se escribio nada)') + ': ' + cambios.length + ' cambio(s).\n' +
      lineas.join('\n') + (faltan.length ? '\nNo encontrados (ids): ' + faltan.join(', ') : ''));
  } finally {
    lock.releaseLock();
  }
}
function ef_kalis_simular() { ef_kalis_(false); }
function ef_kalis_aplicar() { ef_kalis_(true); }
