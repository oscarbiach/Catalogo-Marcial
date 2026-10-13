/* eslint-disable no-console */
/**
 * Pruebas de ListaPDF.gs: el PDF publico de la lista de precios. Simula la
 * descarga de la planilla y Drive en memoria; no usa red.
 *
 *   node pruebas/apps-script/lista-pdf.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const FUENTE = fs.readFileSync(path.join(__dirname, '..', '..', 'apps-script', 'ListaPDF.gs'), 'utf8');

/** CSV como lo devuelve la exportacion de Google (comillas solo si hace falta). */
function csv(filas) {
  return filas.map((f) => f.map((c) => (/[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c)).join(',')).join('\n');
}

const HOJA = [
  ['', 'MAYORISTA DE ALIMENTOS', '', '', '', '', '', '', ''],
  ['Salsas', '', '', '', '', '', 'KILO', 'UNIDAD', 'CAJA'],
  ['Tomate Triturado Lata 8kg - Doble Surco', '', '', '', '', '', '-', '$10,712', '-'],
  ['Rabo - La Morena', '', '', '', '', '', '$12,375', '-', '-'],
  ['Tripa  Gorda - La Morena', '', '', '', '', '', '$6,250', '-', '-'],
  ['Aguja - La Morena', '', '', '', '', '', '$18,750', '-', '-'],
  ['RANDOM', '', '', '', '', '', '$0', '-', '-'],
];

function cargar(hoja, config) {
  const urls = [];
  const props = {};
  const registro = [];
  const ctx = {
    Logger: { log: (t) => registro.push(String(t)) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ScriptApp: { getOAuthToken: () => 'token' },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = v; },
    }) },
    Utilities: {
      parseCsv: (t) => t.split('\n').map((l) => {
        const out = []; let cur = ''; let q = false;
        for (let i = 0; i < l.length; i++) {
          const c = l[i];
          if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
          else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
        }
        out.push(cur); return out;
      }),
      computeDigest: (alg, s) => Array.from(Buffer.from(require('crypto').createHash('md5').update(s).digest())),
      DigestAlgorithm: { MD5: 'MD5' },
    },
    UrlFetchApp: {
      fetch: (url) => {
        urls.push(url);
        if (url.indexOf('format=csv') > -1) return { getResponseCode: () => 200, getContentText: () => csv(hoja) };
        if (url.indexOf('format=pdf') > -1) return { getResponseCode: () => 200, getBlob: () => ({ setName() { return this; }, getBytes: () => [] }) };
        return { getResponseCode: () => 200 };   // subida a Drive
      },
    },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'a' }, Permission: { VIEW: 'v' },
      getFileById: () => ({ isTrashed: () => false, getId: () => 'PDF1' }),
      getRootFolder: () => ({ createFile: () => ({ setSharing() {}, getId: () => 'PDF1' }) }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(FUENTE + '\n;this.__api = { actualizarListaPDF, regenerarListaPDF, probarSinGuardar, CONFIG };', ctx);
  Object.assign(ctx.__api.CONFIG, config || {});
  return { api: ctx.__api, urls, props, registro };
}

const casos = [];
const caso = (nombre, fn) => casos.push([nombre, fn]);

caso('Apunta a Precios Publicos, pestania 0, y corta en "Tripa Gorda - La Morena"', () => {
  const { api } = cargar(HOJA);
  assert.strictEqual(api.CONFIG.SPREADSHEET_ID, '1H9JxYDK4FEBnCGfpImrr--rMzoRliwkFea2Jxp-ZMWU');
  assert.strictEqual(api.CONFIG.GID, '0');
  assert.strictEqual(api.CONFIG.CORTAR_DESDE, 'Tripa Gorda - La Morena');
});

caso('El PDF se exporta solo hasta la fila anterior al corte (A1:I4)', () => {
  const { api, urls } = cargar(HOJA);
  api.regenerarListaPDF();
  const pdf = urls.find((u) => u.indexOf('format=pdf') > -1);
  assert.ok(pdf, 'no se pidio el PDF');
  assert.match(pdf, /range=A1%3AI4(&|$)/);
});

caso('probarSinGuardar no muestra nada de debajo del corte', () => {
  const { api, registro } = cargar(HOJA);
  api.probarSinGuardar();
  const todo = registro.join('\n');
  assert.match(todo, /Rango del PDF: A1:I4 \| 4 filas/);
  assert.match(todo, /Rabo - La Morena/);
  assert.doesNotMatch(todo, /Tripa|Aguja|RANDOM/);
});

caso('Sin la fila de corte, no se genera PDF', () => {
  const sinCorte = HOJA.filter((f) => !/Tripa/.test(f[0]));
  const { api, urls } = cargar(sinCorte);
  assert.throws(() => api.regenerarListaPDF(), /No encuentro la fila "Tripa Gorda - La Morena"/);
  assert.ok(!urls.some((u) => u.indexOf('format=pdf') > -1));
});

caso('Con un RANGO fijo, el corte respeta su inicio (A3:I200 -> A3:I6)', () => {
  const hoja = [['x'], ['y']].concat(HOJA);                // la lista empieza en la fila 3
  const { api, urls } = cargar(hoja, { RANGO: 'A3:I200' });
  api.regenerarListaPDF();
  const pdf = urls.find((u) => u.indexOf('format=pdf') > -1);
  assert.match(pdf, /range=A3%3AI6(&|$)/);
});

let fallas = 0;
for (const [nombre, fn] of casos) {
  try { fn(); console.log('  ok    ' + nombre); } catch (err) { fallas++; console.log('  FALLA ' + nombre + '\n        ' + err.message.split('\n')[0]); }
}
console.log('\n' + (casos.length - fallas) + '/' + casos.length + ' casos ok');
process.exit(fallas ? 1 : 0);
