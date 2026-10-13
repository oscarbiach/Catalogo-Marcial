/* eslint-disable no-console */
/**
 * Pruebas de PreciosPublicos.gs: los precios de la pagina salen de la
 * planilla "Precios Publicos". Carga Codigo.gs + Productos.gs +
 * PreciosPublicos.gs con dos planillas simuladas en memoria. No usa red.
 *
 *   node pruebas/apps-script/precios-publicos.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const RAIZ = path.join(__dirname, '..', '..', 'apps-script');
const COLS = ['id', 'sku', 'nombre', 'descripcion', 'categoria', 'marca',
  'precio', 'moneda', 'unidades_caja', 'presentacion', 'imagenes',
  'destacado', 'nuevo', 'sin_stock', 'orden', 'activo', 'actualizado', 'pedidos',
  'rubros', 'codigo_precio', 'unidad_precio', 'solo_caja', 'kg_caja'];

function prod(id, nombre, precio, unidadPrecio, extra) {
  const f = COLS.map(() => '');
  const o = Object.assign({ marca: '', descripcion: '', unidades_caja: '', activo: true }, extra);
  f[0] = id; f[2] = nombre; f[3] = o.descripcion; f[5] = o.marca; f[6] = precio; f[7] = 'ARS';
  f[8] = o.unidades_caja; f[15] = o.activo; f[20] = unidadPrecio;
  return f;
}

/** Fila de la lista: nombre en A (A-F combinadas) y KILO, UNIDAD, CAJA en G, H, I. */
function item(nombre, kilo, unidad, caja) {
  return [nombre, '', '', '', '', '', kilo, unidad, caja];
}

function productos() {
  return [COLS.slice(),
    prod('1', 'Tomate Triturado Lata 8kg', 10000, 'unidad', { descripcion: 'Doble Surco' }),
    prod('2', 'Tybo - Don solano', 10838, 'kg'),
    prod('3', 'Crema De Leche 200gr x 12u - Tremblay', 1900, 'unidad'),
    prod('6', 'Oregano', 8000, 'kg'),
    prod('212', 'KALIS Max Golden (10cm) x 48u', 560, 'unidad', { marca: 'Kalis', unidades_caja: 48 }),
    prod('213', 'KALIS Liso XL Golden (12cm) x 28u', 676, 'unidad', { marca: 'Kalis', unidades_caja: 28 }),
    prod('20', 'Pan de lomo', 900, 'unidad', { marca: 'Kalis' }),
    prod('30', 'Ketchup individual 8gr x 192u - Danica', 10000, 'caja'),
    prod('40', 'Solo caja en la lista', 5000, 'unidad'),
    prod('50', 'Mortadela', 4000, 'kg'),
    prod('60', 'Producto nuevo sin lista', '', 'kg'),
    prod('70', 'Inactivo sin lista', '', 'kg', { activo: false }),
    prod('80', 'Igual que antes', 2500, 'unidad')];
}

function lista() {
  return [
    ['', '', '', '', '', '', '', '', ''],
    item('Salsas', 'KILO', 'UNIDAD', 'CAJA'),                                  // titulo de seccion
    item('Tomate Triturado Lata 8kg - Doble Surco', '-', '$10,712', '-'),    // por nombre + descripcion
    item('Tybo - Don Solano', 9875, '-', '-'),                               // mayusculas distintas
    item('Crema De Leche 200gr x 12u - Tremblay', 1931, '-', '-'),           // unidad escrita bajo KILO
    item('Oregano  - 1kg', '$8,333', '-', '-'),                              // por equivalencia
    item('Max Golden (10cm) x 48u', '-', '$855', '$41,026'),                 // salto > 50%
    item('Liso XL Golden (12cm) x 30u', '-', 978, 29336),                    // caja de 30 vs 28
    item('Pan de lomo', 1250, '-', '-'),                                     // unidad bajo KILO
    item('Ketchup individual 8gr x 192u - Danica', '-', 10546, '-'),         // repetido con
    item('Ketchup individual 8gr x 192u - Danica', '-', 12111, '-'),         //   precios distintos
    item('Solo caja en la lista', '-', '-', 60000),                          // caja no sirve por unidad
    item('Mortadela en la lista', 4500, '-', '-'),                           // va por nombre_lista
    item('Igual que antes', '-', 2500, '-')];
}

function hoja(celdas) {
  const escritas = [];
  const asegurar = (r, c) => {
    while (celdas.length < r) celdas.push([]);
    while (celdas[r - 1].length < c) celdas[r - 1].push('');
  };
  const sh = {
    escritas,
    celdas,
    getLastRow: () => celdas.length,
    getLastColumn: () => Math.max(...celdas.map((f) => {
      let u = f.length; while (u > 0 && String(f[u - 1]) === '') u--; return u;
    })),
    getDataRange: () => ({ getValues: () => celdas.map((f) => f.slice()) }),
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      const rango = {
        getValues: () => {
          const out = [];
          for (let i = 0; i < nr; i++) { asegurar(r + i, c + nc - 1); out.push(celdas[r - 1 + i].slice(c - 1, c - 1 + nc)); }
          return out;
        },
        setValue: (v) => { asegurar(r, c); celdas[r - 1][c - 1] = v; escritas.push([r, c, v]); return rango; },
        setFontWeight: () => rango,
        setBackground: () => rango,
      };
      return rango;
    },
  };
  return sh;
}

function cargar(celdasProductos, celdasLista) {
  const shP = hoja(celdasProductos);
  const shL = hoja(celdasLista);
  const historial = [];
  const registro = [];
  let invalidaciones = 0;
  const ctx = {
    console,
    Logger: { log: (t) => registro.push(t) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    SpreadsheetApp: {
      flush() {},
      openById: (id) => {
        assert.strictEqual(id, '1H9JxYDK4FEBnCGfpImrr--rMzoRliwkFea2Jxp-ZMWU');
        return { getSheets: () => [shL], getSheetByName: () => shL };
      },
      getActiveSpreadsheet: () => ({ getSheetByName: (n) => (n === 'Productos' ? shP : null) }),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    CacheService: { getScriptCache: () => ({ get: () => null, removeAll() {} }) },
  };
  vm.createContext(ctx);
  const fuente = ['Codigo.gs', 'Productos.gs', 'PreciosPublicos.gs']
    .map((f) => fs.readFileSync(path.join(RAIZ, f), 'utf8')).join('\n;\n') + `
    ;this.__api = { pp_simular, pp_aplicar, pp_aplicarTodo, pp_clave_,
      setInvalidar: (fn) => { invalidarCache = fn; },
      setAnotar: (fn) => { ef_anotar_ = fn; } };`;
  vm.runInContext(fuente, ctx);
  const api = ctx.__api;
  api.setInvalidar(() => { invalidaciones++; });
  api.setAnotar((filas) => historial.push(...filas));
  return { api, shP, historial, registro, invalidaciones: () => invalidaciones };
}

const precioDe = (sh, id) => sh.celdas.find((f) => String(f[0]) === id)[6];

const casos = [];
const caso = (nombre, fn) => casos.push([nombre, fn]);

caso('pp_simular no escribe nada', () => {
  const { api, shP, historial } = cargar(productos(), lista());
  const texto = api.pp_simular();
  assert.match(texto, /^SIMULACION/);
  assert.strictEqual(shP.escritas.length, 0);
  assert.strictEqual(historial.length, 0);
});

caso('pp_aplicar: busca por nombre, marca/descripcion, equivalencia y columna; elige la columna correcta', () => {
  const p = productos();
  p[0].push('nombre_lista');                       // la columna ya existe
  p.find((f) => f[0] === '50').push('Mortadela en la lista');
  const { api, shP, historial, invalidaciones } = cargar(p, lista());
  api.pp_aplicar();
  assert.strictEqual(precioDe(shP, '1'), 10712);   // nombre + " - " + descripcion
  assert.strictEqual(precioDe(shP, '2'), 9875);    // mayusculas no cuentan
  assert.strictEqual(precioDe(shP, '3'), 1931);    // unico precio de la fila, aunque este bajo KILO
  assert.strictEqual(precioDe(shP, '6'), 8333);    // PP_EQUIVALENCIAS
  assert.strictEqual(precioDe(shP, '213'), 978);   // nombre sin la marca + equivalencia
  assert.strictEqual(precioDe(shP, '20'), 1250);
  assert.strictEqual(precioDe(shP, '50'), 4500);   // columna nombre_lista
  assert.strictEqual(precioDe(shP, '80'), 2500);
  assert.ok(historial.length >= 7);
  assert.ok(historial.every((h) => h[3] === 'precio'));
  assert.strictEqual(invalidaciones(), 1);
});

caso('No se toca: salto > 50%, repetido con precios distintos, solo caja para precio por unidad, sin lista', () => {
  const { api, shP } = cargar(productos(), lista());
  const texto = api.pp_aplicar();
  assert.strictEqual(precioDe(shP, '212'), 560);   // 560 -> 855 es +53%: queda para revisar
  assert.strictEqual(precioDe(shP, '30'), 10000);  // Ketchup repetido
  assert.strictEqual(precioDe(shP, '40'), 5000);   // la lista solo da CAJA
  assert.strictEqual(precioDe(shP, '60'), '');
  assert.match(texto, /212 KALIS Max Golden/);
  assert.match(texto, /dos veces en la lista/);
  assert.match(texto, /solo tiene precio por CAJA/);
  assert.match(texto, /60 Producto nuevo sin lista/);
  assert.doesNotMatch(texto, /70 Inactivo/);       // los inactivos no ensucian el informe
  assert.match(texto, /la lista da 30 unidades por caja y el catalogo 28/);
});

caso('pp_aplicarTodo aplica tambien los saltos grandes', () => {
  const { api, shP } = cargar(productos(), lista());
  api.pp_aplicarTodo();
  assert.strictEqual(precioDe(shP, '212'), 855);
});

caso('Crea el titulo nombre_lista al final y una segunda pasada no cambia nada', () => {
  const p = productos();
  const { api, shP, historial } = cargar(p, lista());
  api.pp_aplicar();
  assert.strictEqual(shP.celdas[0][COLS.length], 'nombre_lista');
  const antes = historial.length;
  const texto = api.pp_aplicar();
  assert.match(texto, /Precios que cambian: 0 /);
  assert.strictEqual(historial.length, antes);
});

caso('Si a Productos le falta una columna, no toca nada', () => {
  const p = productos();
  p[0][20] = 'otra_cosa';                          // unidad_precio
  const { api, shP } = cargar(p, lista());
  assert.throws(() => api.pp_aplicar(), /Falta la columna "unidad_precio"/);
  assert.strictEqual(shP.escritas.length, 0);
});

caso('Claves: tildes, signos y espacios no cuentan', () => {
  const { api } = cargar(productos(), lista());
  assert.strictEqual(api.pp_clave_('Jamón  Crudo N°0 - 1kg'), 'jamon crudo n 0 1kg');
  assert.strictEqual(api.pp_clave_('Oregano  - 1kg'), api.pp_clave_('oregano - 1KG'));
});

let fallas = 0;
for (const [nombre, fn] of casos) {
  try { fn(); console.log('  ok    ' + nombre); } catch (err) { fallas++; console.log('  FALLA ' + nombre + '\n        ' + err.message.split('\n')[0]); }
}
console.log('\n' + (casos.length - fallas) + '/' + casos.length + ' casos ok');
process.exit(fallas ? 1 : 0);
