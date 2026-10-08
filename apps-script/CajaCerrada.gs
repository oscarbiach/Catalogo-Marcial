/**
 * Venta por caja cerrada: pasa las reglas de Supabase a la planilla.
 * ---------------------------------------------------------------------------
 * [AUDITORIA H01] Hasta ahora la lista de productos que se venden solo por
 * caja cerrada vivia en dos tablas de Supabase (caja_cerrada y
 * caja_cerrada_kg). El Apps Script no la conocia, y si el sitio caia en el
 * respaldo cambiaban las cantidades y los totales. Desde ahora vive en la
 * planilla (columnas solo_caja y kg_caja) y Supabase la copia de ahi.
 *
 * Uso (una sola vez):
 *   1. cc_simular()  -> solo lee y muestra en el registro que haria.
 *   2. cc_aplicar()  -> escribe, deja historial y activa el contrato 2.
 * Para volver atras sin tocar celdas: cc_desactivar().
 *
 * Despues de esto, para marcar un producto nuevo como "solo por caja":
 *   - precio por unidad: solo_caja = si, y unidades_caja con las unidades.
 *   - precio por kilo:   solo_caja = si, y kg_caja con los kilos de la caja.
 */

/** Las reglas tal como estaban en Supabase el 08/10/2026. */
var CC_UNIDADES = {
  '78': 12, '79': 12, '81': 12, '82': 12, '84': 12, '85': 12, '86': 12, '87': 12,
  '88': 12, '89': 12, '90': 12, '91': 10, '92': 10, '93': 10, '94': 24, '95': 24,
  '96': 6, '97': 12, '105': 20, '106': 60, '107': 30, '109': 100, '110': 120,
  '111': 40, '208': 12, '209': 15, '210': 12, '211': 48, '212': 48, '213': 28,
  '214': 48, '215': 48, '216': 28, '217': 30, '218': 20, '225': 36, '226': 12,
  '230': 12, '231': 12
};
var CC_KILOS = { '69': 3.6, '71': 3.6, '73': 3.6 };

function cc_simular() { return cc_migrar_(false); }
function cc_aplicar() { return cc_migrar_(true); }

/** Vuelve al contrato 1 (Supabase usa sus tablas) sin tocar la planilla. */
function cc_desactivar() {
  PropertiesService.getScriptProperties().deleteProperty(CFG.PROP_CAJA_EN_PLANILLA);
  invalidarCache();
  Logger.log('Contrato de caja cerrada desactivado: Supabase vuelve a usar sus tablas.');
}

function cc_migrar_(aplicar) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('La planilla esta ocupada, proba de nuevo en unos segundos.');
  try {
    // A proposito no se usa hojaProductos(): esa completa el encabezado, y la
    // simulacion no tiene que escribir nada.
    var hoja = obtenerPlanilla().getSheetByName(CFG.HOJA_PRODUCTOS);
    if (!hoja) throw new Error('Falta la hoja "' + CFG.HOJA_PRODUCTOS + '".');

    var colSolo = COLUMNAS.indexOf('solo_caja') + 1;
    var colKg = COLUMNAS.indexOf('kg_caja') + 1;
    var colUnid = COLUMNAS.indexOf('unidades_caja') + 1;
    var colPrecio = COLUMNAS.indexOf('unidad_precio') + 1;
    if (colSolo < 1 || colKg < 1) throw new Error('Falta actualizar Codigo.gs: COLUMNAS no tiene solo_caja y kg_caja.');

    // ── 1. La hoja tiene que tener exactamente las columnas que espera el codigo ──
    var ancho = Math.max(hoja.getLastColumn(), COLUMNAS.length);
    var titulos = hoja.getRange(1, 1, 1, ancho).getValues()[0].map(function (t) {
      return String(t).trim().toLowerCase();
    });
    for (var c = 0; c < colSolo - 1; c++) {
      if (titulos[c] !== COLUMNAS[c]) {
        throw new Error('La columna ' + (c + 1) + ' de la hoja se llama "' + titulos[c] + '" y el codigo espera "' +
          COLUMNAS[c] + '". No se toca nada: revisar el orden de las columnas.');
      }
    }
    var n = hoja.getLastRow() - 1;
    if (n < 1) throw new Error('La hoja no tiene productos.');
    [[colSolo, 'solo_caja'], [colKg, 'kg_caja']].forEach(function (par) {
      var titulo = titulos[par[0] - 1] || '';
      if (titulo === par[1]) return;
      if (titulo !== '') {
        throw new Error('La columna ' + par[0] + ' ya se usa para "' + titulo + '". No se toca nada.');
      }
      var ocupadas = hoja.getRange(2, par[0], n, 1).getValues().filter(function (f) {
        return String(f[0]).trim() !== '';
      }).length;
      if (ocupadas) {
        throw new Error('La columna ' + par[0] + ' no tiene titulo pero si ' + ocupadas + ' datos. No se toca nada.');
      }
    });

    // ── 2. Plan ──
    var ids = hoja.getRange(2, 1, n, 1).getValues().map(function (f) { return String(f[0]).trim(); });
    var nombres = hoja.getRange(2, COLUMNAS.indexOf('nombre') + 1, n, 1).getValues();
    var unidades = hoja.getRange(2, colUnid, n, 1).getValues();
    var precios = hoja.getRange(2, colPrecio, n, 1).getValues();
    var fila = {};
    ids.forEach(function (id, i) { if (id) fila[id] = i; });

    var cambios = [];      // { fila, col, valor, campo, antes }
    var avisos = [];
    var poner = function (i, col, campo, valor, antes) {
      cambios.push({ fila: i + 2, col: col, valor: valor, campo: campo, antes: antes, id: ids[i], nombre: String(nombres[i][0]) });
    };

    Object.keys(CC_UNIDADES).forEach(function (id) {
      var i = fila[id];
      if (i === undefined) { avisos.push(id + ': no esta en la planilla, se saltea.'); return; }
      var u = CC_UNIDADES[id];
      var actual = aNumero(unidades[i][0]);
      if (!actual) poner(i, colUnid, 'unidades_caja', u, unidades[i][0]);
      else if (actual !== u) avisos.push(id + ': la planilla dice ' + actual + ' unidades y Supabase ' + u + '. Queda el de la planilla (es el que ya se usaba).');
      if (String(precios[i][0]).trim().toLowerCase() !== 'unidad') {
        avisos.push(id + ': unidad_precio no es "unidad"; el sitio no lo va a vender por caja hasta corregirlo.');
      }
      poner(i, colSolo, 'solo_caja', true, '');
    });

    Object.keys(CC_KILOS).forEach(function (id) {
      var i = fila[id];
      if (i === undefined) { avisos.push(id + ': no esta en la planilla, se saltea.'); return; }
      if (String(precios[i][0]).trim().toLowerCase() !== 'kg') {
        avisos.push(id + ': unidad_precio no es "kg"; el sitio no lo va a vender por caja hasta corregirlo.');
      }
      poner(i, colSolo, 'solo_caja', true, '');
      poner(i, colKg, 'kg_caja', CC_KILOS[id], '');
    });

    var reglas = Object.keys(CC_UNIDADES).length + Object.keys(CC_KILOS).length;
    var lineas = [(aplicar ? 'APLICADO' : 'SIMULACION (no se escribio nada)') + ': ' + reglas + ' reglas, ' + cambios.length + ' celdas.'];
    cambios.forEach(function (x) { lineas.push('  ' + x.id + ' ' + x.nombre + ': ' + x.campo + ' = ' + x.valor); });
    if (avisos.length) {
      lineas.push('Avisos:');
      avisos.forEach(function (a) { lineas.push('  ' + a); });
    }

    // ── 3. Escribir (solo con cc_aplicar) ──
    if (aplicar) {
      if (titulos[colSolo - 1] !== 'solo_caja' || titulos[colKg - 1] !== 'kg_caja') {
        hoja.getRange(1, colSolo, 1, 2).setValues([['solo_caja', 'kg_caja']]).setFontWeight('bold').setBackground('#eef1f5');
      }
      cambios.forEach(function (x) { hoja.getRange(x.fila, x.col).setValue(x.valor); });
      SpreadsheetApp.flush();
      if (typeof ef_anotar_ === 'function' && cambios.length) {
        ef_anotar_(cambios.map(function (x) {
          return [new Date(), x.id, x.nombre, x.campo, String(x.antes === undefined ? '' : x.antes), String(x.valor)];
        }));
      }
      PropertiesService.getScriptProperties().setProperty(CFG.PROP_CAJA_EN_PLANILLA, '1');
      invalidarCache();
      lineas.push('Contrato 2 activo: el catalogo publica soloCaja y kgCaja y Supabase los toma de la planilla.');
    }

    var texto = lineas.join('\n');
    Logger.log(texto);
    return texto;
  } finally {
    lock.releaseLock();
  }
}
