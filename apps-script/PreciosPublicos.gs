/**
 * Precios de la pagina tomados de la planilla "Precios Publicos".
 * ---------------------------------------------------------------------------
 * La pagina y el PDF del boton "Ver lista de precios" salen de la misma
 * planilla: "Precios Publicos" (solo precios de venta, sin costos).
 * Este script copia esos precios a la columna "precio" de la hoja Productos.
 * Supabase los toma de ahi en la sincronizacion de cada 10 minutos.
 *
 * Cada producto se busca en la lista por NOMBRE, no por posicion, en este orden:
 *   1. la columna "nombre_lista" de Productos, si tiene algo escrito;
 *   2. las equivalencias de PP_EQUIVALENCIAS (abajo);
 *   3. el nombre del producto, igual;
 *   4. nombre + " - " + marca, y nombre + " - " + descripcion;
 *   5. el nombre sin la marca adelante ("KALIS Liso..." -> "Liso...").
 * Mayusculas, tildes y signos no cuentan ("Jamon" = "Jam\u00f3n").
 *
 * La columna del precio sale de unidad_precio: kg -> KILO, unidad -> UNIDAD,
 * caja -> CAJA. Si esa celda esta vacia y la fila tiene un solo precio, se usa
 * ese (en la lista hay productos por unidad con el precio bajo KILO).
 *
 * USO:
 *   1. pp_simular()      -> solo lee y muestra en el registro que cambiaria.
 *   2. pp_aplicar()      -> escribe los precios. Los cambios de mas del 50%
 *                           NO se aplican: quedan listados para revisar.
 *   3. pp_aplicarTodo()  -> igual, pero tambien aplica esos cambios grandes.
 *   4. pp_instalar()     -> lo deja corriendo solo cada 15 minutos.
 *      pp_quitar()       -> saca la revision automatica.
 *
 * Si un producto tiene en la lista un nombre distinto, escribir el nombre
 * exacto de la lista en la columna "nombre_lista" de Productos (la crea
 * pp_aplicar al final de la hoja).
 *
 * SOLO LEE "Precios Publicos". En Productos solo escribe precio, actualizado
 * y el titulo de la columna nombre_lista. Cada precio cambiado queda en la
 * hoja "Historial fichas".
 */

// ============================== CONFIGURACION ==============================
var PP = {
  // Planilla "Precios Publicos": el codigo largo de la URL entre /d/ y /edit.
  SPREADSHEET_ID: '1H9JxYDK4FEBnCGfpImrr--rMzoRliwkFea2Jxp-ZMWU',
  // Pestania. '' = la primera.
  HOJA: '',
  // Columnas de la lista (A = 1): nombre y los tres precios.
  COL_NOMBRE: 1,
  COL_KILO: 7,
  COL_UNIDAD: 8,
  COL_CAJA: 9,
  // Cambios mayores a esto (0.5 = 50%) no se aplican solos.
  CAMBIO_MAXIMO: 0.5,
  REVISAR_CADA_MINUTOS: 15,
  COLUMNA_NOMBRE_LISTA: 'nombre_lista'
};

/**
 * id del producto -> nombre en la lista, para los que no coinciden solos.
 * Revisados el 13/10/2026 contra "Precios Publicos" (mismo producto; en el
 * 69, 95 y los Kalis el nombre de la lista dice otra cantidad por caja).
 */
var PP_EQUIVALENCIAS = {
  '6': 'Oregano - 1kg',
  '7': 'Provenzal - 1kg',
  '8': 'Pimenton - 1kg',
  '9': 'Condimento Para Pizza - 1kg',
  '10': 'Chimichurri - 1kg',
  '11': 'Aji Molido - 1kg',
  '12': 'Aceitunas Verdes N\u00b00 5KG - Marques',
  '13': 'Aceitunas Verdes N\u00b00 2KG - Marques',
  '69': 'Cremoso Caja 400gr x 9u - Tremblay',
  '95': 'Dulce De Leche 400gr x 12u - Tremblay',
  '211': 'Liso Golden (10cm) x 48u',
  '212': 'Max Golden (10cm) x 48u',
  '213': 'Liso XL Golden (12cm) x 30u',
  '214': 'Liso Clasico (10cm) x 48u',
  '215': 'Max Clasico (10cm) x 48u',
  '216': 'Liso XL Clasico (12cm) x 30u'
};
// ===========================================================================

function pp_simular() { return pp_correr_({ aplicar: false, forzar: false }); }
function pp_aplicar() { return pp_correr_({ aplicar: true, forzar: false }); }
function pp_aplicarTodo() { return pp_correr_({ aplicar: true, forzar: true }); }

/** La que corre sola: aplica sin forzar y solo deja registro si cambio algo. */
function pp_revisar() { return pp_correr_({ aplicar: true, forzar: false, silencioso: true }); }

function pp_instalar() {
  pp_quitar();
  ScriptApp.newTrigger('pp_revisar').timeBased().everyMinutes(PP.REVISAR_CADA_MINUTOS).create();
  Logger.log('Listo: los precios se revisan cada ' + PP.REVISAR_CADA_MINUTOS + ' minutos.');
}

function pp_quitar() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pp_revisar') ScriptApp.deleteTrigger(t);
  });
}

// ------------------------------- internos ----------------------------------

/** "Jamon Crudo  N\u00b00 - 1kg" -> "jamon crudo n 0 1kg" */
function pp_clave_(texto) {
  return String(texto === null || texto === undefined ? '' : texto)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Precio de una celda de la lista, o null ('-', vacio, texto, cero). */
function pp_precio_(valor) {
  var n = aNumero(valor);
  return n !== null && isFinite(n) && n > 0 ? n : null;
}

/** Lee la lista: clave -> { nombre, kilo, unidad, caja, ambiguo }. */
function pp_leerLista_() {
  var planilla = SpreadsheetApp.openById(PP.SPREADSHEET_ID);
  var hoja = PP.HOJA ? planilla.getSheetByName(PP.HOJA) : planilla.getSheets()[0];
  if (!hoja) throw new Error('No encuentro la pestania "' + PP.HOJA + '" en Precios Publicos.');
  var filas = hoja.getDataRange().getValues();
  var lista = {};
  filas.forEach(function (f) {
    var nombre = String(f[PP.COL_NOMBRE - 1] || '').trim();
    if (!nombre) return;
    var item = {
      nombre: nombre,
      kilo: pp_precio_(f[PP.COL_KILO - 1]),
      unidad: pp_precio_(f[PP.COL_UNIDAD - 1]),
      caja: pp_precio_(f[PP.COL_CAJA - 1])
    };
    if (item.kilo === null && item.unidad === null && item.caja === null) return;   // titulos de seccion
    var k = pp_clave_(nombre);
    var previo = lista[k];
    if (previo && (previo.kilo !== item.kilo || previo.unidad !== item.unidad || previo.caja !== item.caja)) {
      previo.ambiguo = true;   // mismo nombre dos veces con precios distintos
      return;
    }
    if (!previo) lista[k] = item;
  });
  return lista;
}

/** Busca el producto en la lista. Devuelve { item, por } o null. */
function pp_buscar_(lista, p) {
  var marca = pp_clave_(p.marca);
  var nombre = pp_clave_(p.nombre);
  var candidatos = [
    [p.nombreLista, 'columna nombre_lista'],
    [PP_EQUIVALENCIAS[p.id], 'equivalencia'],
    [p.nombre, 'nombre'],
    [p.marca ? p.nombre + ' - ' + p.marca : '', 'nombre y marca'],
    [p.descripcion ? p.nombre + ' - ' + p.descripcion : '', 'nombre y descripcion'],
    [marca && nombre.indexOf(marca + ' ') === 0 ? nombre.slice(marca.length + 1) : '', 'nombre sin la marca']
  ];
  for (var i = 0; i < candidatos.length; i++) {
    var k = pp_clave_(candidatos[i][0]);
    if (k && lista[k]) return { item: lista[k], por: candidatos[i][1] };
  }
  return null;
}

/** Elige el precio segun unidad_precio. { precio, nota } o { precio: null, nota }. */
function pp_elegir_(item, unidadPrecio, unidadesCaja) {
  var col = { kg: 'kilo', unidad: 'unidad', caja: 'caja' }[unidadPrecio] || 'unidad';
  var nota = '';
  if (col === 'unidad' && item.unidad && item.caja && unidadesCaja > 0) {
    var porCaja = Math.round(item.caja / item.unidad);
    if (porCaja !== unidadesCaja) nota = 'la lista da ' + porCaja + ' unidades por caja y el catalogo ' + unidadesCaja;
  }
  if (item[col]) return { precio: item[col], nota: nota };

  var hay = ['kilo', 'unidad', 'caja'].filter(function (c) { return item[c]; });
  if (hay.length !== 1) return { precio: null, nota: 'la lista no tiene precio en ' + col.toUpperCase() };
  // Un precio de caja no sirve como precio por unidad o por kilo.
  if (hay[0] === 'caja' && col !== 'caja') return { precio: null, nota: 'la lista solo tiene precio por CAJA' };
  return { precio: item[hay[0]], nota: 'tomado de la columna ' + hay[0].toUpperCase(), otraColumna: true };
}

function pp_correr_(op) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('La planilla esta ocupada, proba de nuevo en unos segundos.');
  try {
    var lista = pp_leerLista_();
    var hoja = obtenerPlanilla().getSheetByName(CFG.HOJA_PRODUCTOS);
    if (!hoja) throw new Error('Falta la hoja "' + CFG.HOJA_PRODUCTOS + '".');

    var ancho = Math.max(hoja.getLastColumn(), COLUMNAS.length);
    var titulos = hoja.getRange(1, 1, 1, ancho).getValues()[0].map(function (t) { return String(t).trim().toLowerCase(); });
    var col = {};
    ['id', 'nombre', 'marca', 'descripcion', 'precio', 'unidades_caja', 'unidad_precio', 'actualizado', 'activo'].forEach(function (c) {
      var i = titulos.indexOf(c);
      if (i < 0) throw new Error('Falta la columna "' + c + '" en Productos. No se toca nada.');
      col[c] = i;
    });
    var colLista = titulos.indexOf(PP.COLUMNA_NOMBRE_LISTA);   // -1 si todavia no existe

    var n = hoja.getLastRow() - 1;
    if (n < 1) throw new Error('La hoja Productos no tiene productos.');
    var datos = hoja.getRange(2, 1, n, ancho).getValues();

    var cambios = [], grandes = [], sinPar = [], sinPrecio = [], avisos = [], iguales = 0, otraColumna = 0;
    datos.forEach(function (f, i) {
      var id = String(f[col.id]).trim();
      if (!id) return;
      var p = {
        id: id,
        nombre: String(f[col.nombre]).trim(),
        marca: String(f[col.marca]).trim(),
        descripcion: String(f[col.descripcion]).trim(),
        nombreLista: colLista > -1 ? String(f[colLista]).trim() : ''
      };
      var activo = aBool(f[col.activo]);
      var hallado = pp_buscar_(lista, p);
      if (!hallado) {
        if (activo) sinPar.push(id + ' ' + p.nombre);
        return;
      }
      if (hallado.item.ambiguo) {
        avisos.push(id + ' ' + p.nombre + ': "' + hallado.item.nombre + '" esta dos veces en la lista con precios distintos. No se toca.');
        return;
      }
      var unidadPrecio = String(f[col.unidad_precio]).trim().toLowerCase() || 'unidad';
      var eleccion = pp_elegir_(hallado.item, unidadPrecio, aNumero(f[col.unidades_caja]) || 0);
      if (eleccion.otraColumna) otraColumna++;
      else if (eleccion.nota && eleccion.precio !== null && activo) avisos.push(id + ' ' + p.nombre + ': ' + eleccion.nota + '.');
      if (eleccion.precio === null) {
        if (activo) sinPrecio.push(id + ' ' + p.nombre + ': ' + eleccion.nota + '.');
        return;
      }
      var antes = aNumero(f[col.precio]);
      if (antes !== null && Math.abs(antes - eleccion.precio) < 0.5) { iguales++; return; }
      var cambio = {
        fila: i + 2, id: id, nombre: p.nombre, antes: antes, despues: eleccion.precio,
        lista: hallado.item.nombre, por: hallado.por
      };
      var salto = antes ? Math.abs(eleccion.precio - antes) / antes : 0;
      if (salto > PP.CAMBIO_MAXIMO && !op.forzar) grandes.push(cambio);
      else cambios.push(cambio);
    });

    var fmt = function (v) { return v === null || v === undefined ? '(vacio)' : '$' + Math.round(v); };
    var lineas = [];
    lineas.push((op.aplicar ? 'APLICADO' : 'SIMULACION (no se escribio nada)') + ' - lista: ' +
      Object.keys(lista).length + ' productos con precio.');
    lineas.push('Precios que cambian: ' + cambios.length + ' | iguales: ' + iguales +
      ' | cambios grandes sin aplicar: ' + grandes.length + ' | sin precio en la lista: ' + sinPrecio.length +
      ' | activos que no estan en la lista: ' + sinPar.length);
    if (cambios.length) {
      lineas.push('--- CAMBIAN ---');
      cambios.forEach(function (x) {
        lineas.push('  ' + x.id + ' ' + x.nombre + ': ' + fmt(x.antes) + ' -> ' + fmt(x.despues) +
          (x.por === 'nombre' ? '' : '   [por ' + x.por + ': "' + x.lista + '"]'));
      });
    }
    if (grandes.length) {
      lineas.push('--- CAMBIOS DE MAS DEL ' + Math.round(PP.CAMBIO_MAXIMO * 100) + '% (NO aplicados; revisar y usar pp_aplicarTodo) ---');
      grandes.forEach(function (x) { lineas.push('  ' + x.id + ' ' + x.nombre + ': ' + fmt(x.antes) + ' -> ' + fmt(x.despues)); });
    }
    if (sinPrecio.length) { lineas.push('--- SIN PRECIO EN LA LISTA (quedan como estan) ---'); sinPrecio.forEach(function (a) { lineas.push('  ' + a); }); }
    if (sinPar.length) {
      lineas.push('--- ACTIVOS QUE NO ESTAN EN LA LISTA (quedan como estan; escribir el nombre de la lista en "nombre_lista") ---');
      sinPar.forEach(function (a) { lineas.push('  ' + a); });
    }
    if (otraColumna) {
      lineas.push('Nota: ' + otraColumna + ' productos tienen en la lista el precio en otra columna (por ejemplo, ' +
        'precio por unidad escrito bajo KILO). Se usa ese precio igual, porque es el unico de la fila.');
    }
    if (avisos.length) { lineas.push('--- AVISOS ---'); avisos.forEach(function (a) { lineas.push('  ' + a); }); }

    if (op.aplicar) {
      if (colLista < 0) {
        hoja.getRange(1, ancho + 1).setValue(PP.COLUMNA_NOMBRE_LISTA).setFontWeight('bold').setBackground('#eef1f5');
      }
      var hoy = new Date();
      cambios.forEach(function (x) {
        hoja.getRange(x.fila, col.precio + 1).setValue(x.despues);
        hoja.getRange(x.fila, col.actualizado + 1).setValue(hoy);
      });
      if (cambios.length) {
        SpreadsheetApp.flush();
        if (typeof ef_anotar_ === 'function') {
          ef_anotar_(cambios.map(function (x) {
            return [hoy, x.id, x.nombre, 'precio', x.antes === null ? '' : String(x.antes), String(x.despues)];
          }));
        }
        invalidarCache();
      }
    }

    var texto = lineas.join('\n');
    if (!op.silencioso || cambios.length || grandes.length) Logger.log(texto);
    return texto;
  } finally {
    lock.releaseLock();
  }
}
