/* eslint-disable no-console */
/**
 * Pruebas unitarias de la logica pura del sitio (docs/assets/js/contrato.js y
 * pedido.js). Corren en Node, sin navegador ni red:
 *
 *   node pruebas/unidad/logica.test.mjs
 *
 * Los casos de precios son los mismos que usa pruebas/sql/casos.sql contra
 * registrar_pedido: si el navegador y la base dejan de coincidir, falla.
 */
import assert from 'node:assert';
import {
  ESQUEMA_CACHE, normalizar, redondear2, comoNumero, comoBooleano,
  normalizarCatalogo, aplicarReglasCaja,
} from '../../docs/assets/js/contrato.js';
import {
  unidadDe, soloPorCaja, contenidoCaja, precioDeLinea, seCuentaPorCaja, totalPedido,
} from '../../docs/assets/js/pedido.js';

const casos = [];
const caso = (nombre, fn) => casos.push([nombre, fn]);

const crudo = () => ({
  ok: true, config: { whatsapp: 5491100000000 }, categorias: ['A', { nombre: 'B' }],
  productos: [
    { id: 105, nombre: ' Manteca x 20 ', precio: '1624', unidadPrecio: 'Unidad', unidadesCaja: 20, soloCaja: true },
    { id: '200', nombre: 'Cremoso', precio: 0.10, unidadPrecio: 'kg', soloCaja: 'true', kgCaja: '1.25' },
    { id: '300', nombre: 'Mayonesa', precio: 500, moneda: 'USD' },
  ],
});

// ── contrato.js ──
caso('redondear2 igual que round(numeric, 2) de Postgres', () => {
  assert.strictEqual(redondear2(1.005), 1.01);
  assert.strictEqual(redondear2(0.1 * 1.25), 0.13);
  assert.strictEqual(redondear2(2.675), 2.68);
  assert.strictEqual(redondear2(-1.005), -1.01);
  assert.strictEqual(redondear2(32480), 32480);
});

caso('normalizar quita acentos y mayusculas', () => {
  assert.strictEqual(normalizar('Jamón CRUDO Ñandú'), 'jamon crudo nandu');
});

caso('comoNumero y comoBooleano no dejan pasar basura', () => {
  assert.strictEqual(comoNumero('12', 0), 12);
  assert.strictEqual(comoNumero('abc', 7), 7);
  assert.strictEqual(comoNumero(Infinity, 7), 7);
  assert.strictEqual(comoNumero(true, 7), 7);
  assert.strictEqual(comoBooleano('si'), true);
  assert.strictEqual(comoBooleano('no'), false);
});

caso('normalizarCatalogo: tipos limpios y esquema', () => {
  const d = normalizarCatalogo(crudo(), 'supabase');
  assert.strictEqual(d.esquema, ESQUEMA_CACHE);
  assert.strictEqual(d.config.whatsapp, '5491100000000');
  assert.deepStrictEqual(d.categorias, ['A', 'B']);
  const [p105, p200] = d.productos;
  assert.deepStrictEqual([p105.id, p105.nombre, p105.precio, p105.unidadPrecio], ['105', 'Manteca x 20', 1624, 'unidad']);
  assert.deepStrictEqual([p200.soloCaja, p200.kgCaja], [true, 1.25]);
  assert.ok(p105.heno.includes('manteca'));
});

caso('normalizarCatalogo rechaza estructuras invalidas (H05)', () => {
  assert.throws(() => normalizarCatalogo({ ok: true, config: {}, productos: {} }), /lista de productos/);
  assert.throws(() => normalizarCatalogo({ ok: true, productos: [] }), /configuracion/);
  assert.throws(() => normalizarCatalogo({ ok: false }), /formato/);
  assert.throws(() => normalizarCatalogo({ ok: true, config: {}, productos: [{ id: '', nombre: 'x' }] }), /sin productos validos/);
});

caso('normalizarCatalogo descarta repetidos y precios negativos', () => {
  const c = crudo();
  c.productos.push({ id: '105', nombre: 'Repetido' }, { id: '400', nombre: 'Negativo', precio: -5 });
  const d = normalizarCatalogo(c, 'apps-script');
  assert.strictEqual(d.productos.filter((p) => p.id === '105').length, 1);
  assert.strictEqual(d.productos.find((p) => p.id === '400').precio, null);
});

caso('aplicarReglasCaja: sin reglas pasa a modo consulta (H01)', () => {
  const d = aplicarReglasCaja(normalizarCatalogo(crudo(), 'apps-script'), null);
  assert.strictEqual(d.reglasCaja, 'faltan');
});

caso('aplicarReglasCaja: hereda unidades y kilos guardados (H01)', () => {
  const c = crudo();
  delete c.productos[0].unidadesCaja; c.productos[0].soloCaja = false; c.productos[1].soloCaja = false;
  const d = aplicarReglasCaja(normalizarCatalogo(c, 'apps-script'), { 105: { u: 20, kg: 0 }, 200: { u: 0, kg: 1.25 } });
  const [p105, p200, p300] = d.productos;
  assert.strictEqual(d.reglasCaja, 'heredadas');
  assert.deepStrictEqual([p105.soloCaja, p105.unidadesCaja], [true, 20]);
  assert.deepStrictEqual([p200.soloCaja, p200.kgCaja], [true, 1.25]);
  assert.strictEqual(p300.soloCaja, false);
});

// ── pedido.js ──
caso('Venta por caja: unidades, contenido y precio de la caja', () => {
  const [p105, p200, p300] = normalizarCatalogo(crudo(), 'supabase').productos;
  assert.strictEqual(soloPorCaja(p105), true);
  assert.strictEqual(contenidoCaja(p105), '20');
  assert.strictEqual(precioDeLinea(p105), 32480);
  assert.strictEqual(unidadDe(p105, 2), 'cajas');
  assert.strictEqual(seCuentaPorCaja(p105), true);
  assert.strictEqual(precioDeLinea(p200), 0.13);   // 0,10 x 1,25 kg redondeado
  assert.strictEqual(soloPorCaja(p300), false);
  assert.strictEqual(unidadDe(p300, 1), 'unidad');
});

caso('Total igual al de registrar_pedido: 2 cajas del 105 + 3 del 200 = 64.960,39', () => {
  const [p105, p200] = normalizarCatalogo(crudo(), 'supabase').productos;
  const lineas = [
    { producto: p105, cantidad: 2, subtotal: redondear2(precioDeLinea(p105) * 2) },
    { producto: p200, cantidad: 3, subtotal: redondear2(precioDeLinea(p200) * 3) },
  ];
  assert.deepStrictEqual(totalPedido(lineas), { total: 64960.39, moneda: 'ARS' });
});

caso('Monedas mezcladas: total a confirmar (H10)', () => {
  const [p105, , p300] = normalizarCatalogo(crudo(), 'supabase').productos;
  const t = totalPedido([{ producto: p105, cantidad: 1, subtotal: 32480 }, { producto: p300, cantidad: 1, subtotal: 500 }]);
  assert.strictEqual(t.total, null);
});

let fallas = 0;
for (const [nombre, fn] of casos) {
  try { fn(); console.log('  ok    ' + nombre); } catch (err) { fallas++; console.log('  FALLA ' + nombre + '\n        ' + err.message.split('\n')[0]); }
}
console.log('\n' + (casos.length - fallas) + '/' + casos.length + ' casos ok');
process.exit(fallas ? 1 : 0);
