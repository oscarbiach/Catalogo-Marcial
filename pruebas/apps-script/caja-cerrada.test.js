/* eslint-disable no-console */
/**
 * Pruebas del contrato de caja cerrada en Apps Script (auditoria H01).
 * Carga Codigo.gs + Productos.gs + CajaCerrada.gs + EditorFichas.gs con una
 * planilla simulada en memoria. No usa red ni Google.
 *
 *   node pruebas/apps-script/caja-cerrada.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const RAIZ = path.join(__dirname, '..', '..', 'apps-script');
const COLS21 = ['id', 'sku', 'nombre', 'descripcion', 'categoria', 'marca',
  'precio', 'moneda', 'unidades_caja', 'presentacion', 'imagenes',
  'destacado', 'nuevo', 'sin_stock', 'orden', 'activo', 'actualizado', 'pedidos',
  'rubros', 'codigo_precio', 'unidad_precio'];

/** Fila de 21 columnas como la de produccion antes del cambio. */
function fila(id, nombre, unidades, unidadPrecio) {
  const f = COLS21.map(() => '');
  f[0] = id; f[2] = nombre; f[6] = 1000; f[7] = 'ARS'; f[8] = unidades; f[15] = true; f[20] = unidadPrecio;
  return f;
}

function planillaDePrueba() {
  return [COLS21.slice(),
    fila('105', 'Manteca x 20', 20, 'unidad'),
    fila('110', 'Rallado x 120', '', 'unidad'),     // sin unidades: las pone la migracion
    fila('69', 'Cremoso caja', '', 'kg'),
    fila('300', 'Mayonesa', '', 'unidad')];
}

/** Hoja simulada con la API minima que usan los scripts. */
function hoja(celdas) {
  const escritas = [];
  const asegurar = (r, c) => {
    while (celdas.length < r) celdas.push([]);
    while (celdas[r - 1].length < c) celdas[r - 1].push('');
  };
  const ancho = () => Math.max(...celdas.map((f) => {
    let u = f.length; while (u > 0 && String(f[u - 1]) === '') u--; return u;
  }));
  return {
    escritas,
    celdas,
    getLastRow: () => celdas.length,
    getLastColumn: ancho,
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      const rango = {
        getValue: () => { asegurar(r, c); return celdas[r - 1][c - 1]; },
        getValues: () => {
          const out = [];
          for (let i = 0; i < nr; i++) {
            asegurar(r + i, c + nc - 1);
            out.push(celdas[r - 1 + i].slice(c - 1, c - 1 + nc));
          }
          return out;
        },
        setValue: (v) => { asegurar(r, c); celdas[r - 1][c - 1] = v; escritas.push([r, c, v]); return rango; },
        setValues: (vals) => {
          vals.forEach((f, i) => f.forEach((v, j) => {
            asegurar(r + i, c + j); celdas[r - 1 + i][c - 1 + j] = v; escritas.push([r + i, c + j, v]);
          }));
          return rango;
        },
        setFontWeight: () => rango, setBackground: () => rango,
      };
      return rango;
    },
    appendRow: (f) => { celdas.push(f.slice()); escritas.push(['append']); },
  };
}

function cargar(celdas) {
  const sh = hoja(celdas);
  const props = {};
  const historial = [];
  let invalidaciones = 0;
  const ctx = {
    console,
    Logger: { log: () => {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock() {} }) },
    SpreadsheetApp: {
      flush() {},
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => (n === 'Productos' ? sh : null),
        insertSheet: () => ({ getRange: () => ({ setValues: () => ({ setFontWeight() {} }) }), setFrozenRows() {}, getLastRow: () => 1 }),
        setActiveSheet() {}, getSheets: () => [],
      }),
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = v; },
      deleteProperty: (k) => { delete props[k]; },
    }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, putAll() {}, getAll: () => ({}), remove() {}, removeAll() {} }) },
    Utilities: { getUuid: () => 'uuid-' + Math.random().toString(16).slice(2) },
  };
  vm.createContext(ctx);
  const fuente = ['Codigo.gs', 'Productos.gs', 'CajaCerrada.gs', 'EditorFichas.gs']
    .map((f) => fs.readFileSync(path.join(RAIZ, f), 'utf8')).join('\n;\n') + `
    ;function pedidosDeTabla() { return 0; }
    function buscarLogoEnDrive() { return ''; }
    function espejarUnProducto() {}
    function hojaConfig() { return { getLastRow: () => 1 }; }
    function exigirSesion() {}
    this.__api = { cc_simular, cc_aplicar, cc_desactivar, construirCatalogo, guardarProducto, aKilos, leerProductos,
      setInvalidar: (fn) => { invalidarCache = fn; }, setAnotar: (fn) => { ef_anotar_ = fn; } };`;
  vm.runInContext(fuente, ctx);
  const api = ctx.__api;
  api.setInvalidar(() => { invalidaciones++; });
  api.setAnotar((filas) => historial.push(...filas));
  return { api, sh, props, historial, invalidaciones: () => invalidaciones };
}

const casos = [];
function caso(nombre, fn) { casos.push([nombre, fn]); }

caso('aKilos: coma y punto son decimales; fuera de rango es 0', () => {
  const { api } = cargar(planillaDePrueba());
  assert.strictEqual(api.aKilos('3,6'), 3.6);
  assert.strictEqual(api.aKilos('0.500'), 0.5);
  assert.strictEqual(api.aKilos(3.6), 3.6);
  assert.strictEqual(api.aKilos(''), 0);
  assert.strictEqual(api.aKilos('abc'), 0);
  assert.strictEqual(api.aKilos(5000), 0);
});

caso('Antes de migrar: contrato 1 (Supabase sigue usando sus tablas)', () => {
  const { api } = cargar(planillaDePrueba());
  const cat = api.construirCatalogo();
  assert.strictEqual(cat.contrato, 1);
  assert.ok(cat.productos.every((p) => p.soloCaja === false && p.kgCaja === 0));
});

caso('cc_simular no escribe nada', () => {
  const { api, sh, props } = cargar(planillaDePrueba());
  const texto = api.cc_simular();
  assert.match(texto, /SIMULACION/);
  assert.strictEqual(sh.escritas.length, 0);
  assert.strictEqual(props.CAJA_EN_PLANILLA, undefined);
});

caso('cc_aplicar: columnas, reglas, unidades faltantes, historial y contrato 2', () => {
  const t = cargar(planillaDePrueba());
  t.api.cc_aplicar();
  const c = t.sh.celdas;
  assert.deepStrictEqual(c[0].slice(21, 23), ['solo_caja', 'kg_caja']);
  assert.strictEqual(c[1][21], true);          // 105
  assert.strictEqual(c[1][8], 20);             // unidades que ya tenia, intactas
  assert.strictEqual(c[2][8], 120);            // 110: completadas desde la regla
  assert.strictEqual(c[3][21], true);          // 69
  assert.strictEqual(c[3][22], 3.6);
  assert.strictEqual(String(c[4][21] || ''), ''); // 300: no es por caja
  assert.strictEqual(t.props.CAJA_EN_PLANILLA, '1');
  assert.ok(t.historial.length >= 4);
  assert.strictEqual(t.invalidaciones(), 1);

  const cat = t.api.construirCatalogo();
  assert.strictEqual(cat.contrato, 2);
  const p = Object.fromEntries(cat.productos.map((x) => [x.id, x]));
  assert.deepStrictEqual([p['105'].soloCaja, p['105'].unidadesCaja], [true, 20]);
  assert.deepStrictEqual([p['69'].soloCaja, p['69'].kgCaja], [true, 3.6]);
  assert.strictEqual(p['300'].soloCaja, false);
});

caso('Guardar desde el panel no le borra la regla al producto', () => {
  const t = cargar(planillaDePrueba());
  t.api.cc_aplicar();
  // El panel manda el producto sin solo_caja ni kg_caja
  t.api.guardarProducto('tok', { id: '69', nombre: 'Cremoso caja (renombrado)', precio: 1, unidad_precio: 'kg' });
  const f = t.sh.celdas[3];
  assert.strictEqual(f[2], 'Cremoso caja (renombrado)');
  assert.strictEqual(f[21], true);
  assert.strictEqual(f[22], 3.6);
});

caso('Columnas corridas: no escribe nada', () => {
  const celdas = planillaDePrueba();
  celdas[0][20] = 'otra_cosa';
  const t = cargar(celdas);
  assert.throws(() => t.api.cc_aplicar(), /espera "unidad_precio"/);
  assert.strictEqual(t.sh.escritas.length, 0);
  assert.strictEqual(t.props.CAJA_EN_PLANILLA, undefined);
});

caso('Columna 22 ocupada por otro dato: no escribe nada', () => {
  const celdas = planillaDePrueba();
  celdas[2][21] = 'algo';
  const t = cargar(celdas);
  assert.throws(() => t.api.cc_aplicar(), /no tiene titulo pero si 1 datos/);
  assert.strictEqual(t.sh.escritas.length, 0);
});

caso('cc_desactivar vuelve al contrato 1', () => {
  const t = cargar(planillaDePrueba());
  t.api.cc_aplicar();
  t.api.cc_desactivar();
  assert.strictEqual(t.api.construirCatalogo().contrato, 1);
});

let fallas = 0;
for (const [nombre, fn] of casos) {
  try { fn(); console.log('  ok    ' + nombre); } catch (err) { fallas++; console.log('  FALLA ' + nombre + '\n        ' + err.message.split('\n')[0]); }
}
console.log('\n' + (casos.length - fallas) + '/' + casos.length + ' casos ok');
process.exit(fallas ? 1 : 0);
