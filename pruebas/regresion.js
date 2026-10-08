/* eslint-disable no-console */
/**
 * Pruebas de regresion del catalogo publico (auditoria H01-H18).
 *
 * Levanta docs/ en un servidor local y simula Supabase y Apps Script con
 * Playwright: no toca produccion ni registra pedidos reales.
 *
 *   NODE_PATH=$(npm root -g) node pruebas/regresion.js
 *
 * Requiere el paquete `playwright` (global o local) y Chromium. En GitHub
 * corre solo en cada PR (.github/workflows/pruebas.yml).
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..', 'docs');
const SB = 'https://tdyekqddpchjjiuhglhv.supabase.co';
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

// ── Datos de prueba ────────────────────────────────────────────────────
const AHORA = new Date().toISOString();
function filasSupabase() {
  return [
    { id: '105', nombre: 'Pan de campo', precio: 1624, moneda: 'ARS', unidades_caja: 20, solo_caja: true, kg_caja: 0, unidad_precio: 'unidad', categoria: 'Panificados', marca: 'A', imagenes: [], rubros: [], destacado: false, nuevo: false, sin_stock: false, orden: 1, sku: '', descripcion: '', presentacion: '' },
    { id: '200', nombre: 'Cremoso chico', precio: 0.10, moneda: 'ARS', unidades_caja: 0, solo_caja: true, kg_caja: 1.25, unidad_precio: 'kg', categoria: 'Quesos y Lacteos', marca: 'B', imagenes: [], rubros: [], destacado: false, nuevo: false, sin_stock: false, orden: 2, sku: '', descripcion: '', presentacion: '' },
    { id: '300', nombre: 'Mayonesa', precio: 500, moneda: 'ARS', unidades_caja: 0, solo_caja: false, kg_caja: 0, unidad_precio: 'unidad', categoria: 'Mayonesas y Aderezos', marca: 'C', imagenes: [], rubros: [], destacado: false, nuevo: false, sin_stock: false, orden: 3, sku: '', descripcion: '', presentacion: '' },
  ];
}
function configSupabase(sincronizadoEn) {
  return [
    { clave: 'whatsapp', valor: '5491100000000' },
    { clave: 'negocio_nombre', valor: 'Marcial' },
    { clave: '_categorias', valor: JSON.stringify(['Panificados', 'Quesos y Lacteos', 'Mayonesas y Aderezos']) },
    { clave: '_marcas', valor: JSON.stringify(['A', 'B', 'C']) },
    { clave: '_sincronizado_en', valor: JSON.stringify(sincronizadoEn || AHORA) },
  ];
}
// Apps Script: mismo catalogo, SIN soloCaja/kgCaja ni unidades de la lista caja_cerrada (H01).
const APPS_SCRIPT = {
  ok: true, version: 1,
  config: { whatsapp: '5491100000000', negocio_nombre: 'Marcial' },
  categorias: ['Panificados', 'Quesos y Lacteos', 'Mayonesas y Aderezos'], marcas: ['A', 'B', 'C'], rubros: [],
  productos: [
    { id: '105', nombre: 'Pan de campo', precio: 1624, unidadPrecio: 'unidad', unidadesCaja: '', categoria: 'Panificados', marca: 'A' },
    { id: '200', nombre: 'Cremoso chico', precio: 0.10, unidadPrecio: 'kg', categoria: 'Quesos y Lacteos', marca: 'B' },
    { id: '300', nombre: 'Mayonesa', precio: 500, unidadPrecio: 'unidad', categoria: 'Mayonesas y Aderezos', marca: 'C' },
  ],
};

// ── Infraestructura ────────────────────────────────────────────────────
function servidor() {
  return new Promise((listo) => {
    const s = http.createServer((req, res) => {
      const ruta = path.join(RAIZ, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
      if (!ruta.startsWith(RAIZ) || !fs.existsSync(ruta)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(ruta)] || 'application/octet-stream' });
      fs.createReadStream(ruta).pipe(res);
    });
    s.listen(0, '127.0.0.1', () => listo(s));
  });
}

/**
 * Prepara una pagina con las fuentes simuladas.
 * opciones.supabase: 'ok' | 'caido' | 'colgado'
 * opciones.registro: (cuerpo) => { status, body }
 */
async function abrir(navegador, base, opciones) {
  const o = Object.assign({ supabase: 'ok', registro: null, storage: null, demoraSupabase: 0, sincronizadoEn: null }, opciones);
  const contexto = o.contexto || await navegador.newContext({ serviceWorkers: 'block' });
  const registros = [];
  await contexto.route(/drive\.google\.com|googleusercontent|wa\.me|whatsapp/, (r) => r.fulfill({ status: 204, body: '' }));
  await contexto.route(SB + '/rest/v1/**', async (r) => {
    const url = r.request().url();
    if (url.includes('/rpc/registrar_pedido')) {
      const cuerpo = JSON.parse(r.request().postData() || '{}');
      registros.push(cuerpo);
      const resp = o.registro ? o.registro(cuerpo) : { status: 200, body: { id: 'x', ref: cuerpo.p_ref, total: 0, duplicado: registros.length > 1 } };
      return r.fulfill({ status: resp.status, contentType: 'application/json', body: JSON.stringify(resp.body) });
    }
    if (o.supabase === 'caido') return r.fulfill({ status: 503, body: 'caido' });
    if (o.supabase === 'colgado') return; // nunca responde
    if (o.demoraSupabase) await new Promise((x) => setTimeout(x, o.demoraSupabase));
    const cuerpo = url.includes('/productos') ? filasSupabase() : configSupabase(o.sincronizadoEn);
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) });
  });
  await contexto.route(/script\.google\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(APPS_SCRIPT) }));
  if (o.storage) {
    await contexto.addInitScript((datos) => {
      if (sessionStorage.getItem('__sembrado')) return;
      sessionStorage.setItem('__sembrado', '1');
      Object.keys(datos).forEach((k) => localStorage.setItem(k, datos[k]));
    }, o.storage);
  }
  const pagina = await contexto.newPage();
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(e.message));
  await pagina.goto(base + '/index.html');
  return { pagina, contexto, registros, errores };
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }

async function sumar(pagina, id, veces) {
  for (let i = 0; i < (veces || 1); i++) {
    await pagina.locator('#grilla .pieza[data-id="' + id + '"] [data-accion="sumar"]').click();
  }
}
async function esperarCatalogo(pagina) {
  await pagina.locator('#grilla .pieza[data-id="105"]').waitFor();
}

// ── Casos ──────────────────────────────────────────────────────────────
caso('H01 Supabase: el 105 se pide por caja de 20 y el subtotal es de la caja', async (nav, base) => {
  const { pagina, errores } = await abrir(nav, base);
  await esperarCatalogo(pagina);
  assert.match(await pagina.locator('.pieza[data-id="105"] .pieza-unit').innerText(), /caja de 20/);
  await sumar(pagina, '105');
  await pagina.locator('#carrito').click();
  assert.match(await pagina.locator('#pedido-total').innerText(), /32\.480/);
  assert.deepStrictEqual(errores, []);
});

caso('H01 Respaldo sin reglas conocidas: modo consulta, sin carrito y con aviso', async (nav, base) => {
  const { pagina } = await abrir(nav, base, { supabase: 'caido' });
  await esperarCatalogo(pagina);
  await pagina.locator('#aviso-datos').waitFor({ state: 'visible' });
  assert.match(await pagina.locator('#aviso-datos').innerText(), /respaldo/);
  assert.strictEqual(await pagina.locator('#grilla [data-accion="sumar"]').count(), 0);
  assert.strictEqual(await pagina.locator('#carrito').isHidden(), true);
});

caso('H01 Respaldo con reglas de una visita anterior: mantiene caja de 20 y $32.480', async (nav, base) => {
  const contexto = await nav.newContext({ serviceWorkers: 'block' });
  const reglas = JSON.stringify({ guardadoEn: Date.now(), reglas: { '105': { u: 20, kg: 0 }, '200': { u: 0, kg: 1.25 } } });
  const { pagina } = await abrir(nav, base, { contexto, supabase: 'caido', storage: { catalogo_reglas_caja_v1: reglas } });
  await esperarCatalogo(pagina);
  await pagina.waitForFunction(() => document.querySelector('.pieza[data-id="105"] .pieza-unit'));
  assert.match(await pagina.locator('.pieza[data-id="105"] .pieza-unit').innerText(), /caja de 20/);
  await sumar(pagina, '105');
  await pagina.locator('#carrito').click();
  assert.match(await pagina.locator('#pedido-total').innerText(), /32\.480/);
  await contexto.close();
});

caso('H02 Enviar: registra con p_ref, muestra "registrado" y reenviar no cambia la ref', async (nav, base) => {
  const { pagina, registros } = await abrir(nav, base);
  await esperarCatalogo(pagina);
  await sumar(pagina, '300', 2);
  await pagina.locator('#carrito').click();
  const href = await pagina.locator('#pedido-enviar').getAttribute('href');
  assert.match(decodeURIComponent(href), /Ref: [0-9A-F]{8}/);
  await pagina.locator('#pedido-enviar').click();
  await pagina.locator('#enviado-registro').filter({ hasText: 'registrado' }).waitFor();
  assert.match(await pagina.locator('#pedido-vista-enviado h3').innerText(), /listo en whatsapp/i);
  await pagina.locator('#enviado-volver').click();
  await pagina.locator('#pedido-enviar').click();
  await pagina.waitForFunction(() => document.querySelector('#enviado-registro').textContent.includes('registrado'));
  assert.strictEqual(registros.length, 2);
  assert.strictEqual(registros[0].p_ref, registros[1].p_ref);
  assert.deepStrictEqual(registros[0].p_items, [{ id: '300', cantidad: 2 }]);
  // Cambiar el pedido genera otra ref
  await pagina.locator('#enviado-volver').click();
  await pagina.locator('#pedido-lineas [data-accion="sumar"]').click();
  await pagina.locator('#pedido-enviar').click();
  await pagina.waitForFunction(() => document.querySelector('#enviado-registro').textContent.includes('registrado'));
  assert.notStrictEqual(registros[2].p_ref, registros[0].p_ref);
});

caso('H02 Registro rechazado (HTTP 400) se informa, no se presenta como exito', async (nav, base) => {
  const { pagina } = await abrir(nav, base, {
    registro: () => ({ status: 400, body: { message: 'Algunos productos ya no estan disponibles.', hint: 'productos_no_disponibles' } }),
  });
  await esperarCatalogo(pagina);
  await sumar(pagina, '300');
  await pagina.locator('#carrito').click();
  await pagina.locator('#pedido-enviar').click();
  await pagina.locator('#enviado-registro.alerta').waitFor();
  assert.match(await pagina.locator('#enviado-registro').innerText(), /ya no estan disponibles/);
});

caso('H05 Cache con forma invalida no bloquea la carga', async (nav, base) => {
  const mala = JSON.stringify({ esquema: 2, guardadoEn: Date.now(), datos: { ok: true, config: {}, productos: {} } });
  const vieja = JSON.stringify({ guardadoEn: Date.now(), datos: { ok: true, productos: {} } });
  const { pagina, errores } = await abrir(nav, base, { storage: { catalogo_datos_v2: mala, catalogo_datos_v1: vieja } });
  await esperarCatalogo(pagina);
  assert.deepStrictEqual(errores, []);
});

caso('H06 Sincronizacion parada hace 5 h: aviso visible', async (nav, base) => {
  const { pagina } = await abrir(nav, base, { sincronizadoEn: new Date(Date.now() - 5 * 3600e3).toISOString() });
  await esperarCatalogo(pagina);
  await pagina.locator('#aviso-datos').waitFor({ state: 'visible' });
  assert.match(await pagina.locator('#aviso-datos').innerText(), /ultima vez/);
});

caso('H08 Cantidad guardada de 5000 se recorta a 999', async (nav, base) => {
  const { pagina } = await abrir(nav, base, { storage: { catalogo_pedido_v1: JSON.stringify({ '300': 5000 }) } });
  await esperarCatalogo(pagina);
  await pagina.locator('#carrito').click();
  assert.strictEqual(await pagina.locator('#pedido-lineas .paso-valor').inputValue(), '999');
});

caso('H09 Caja por kilo: 0,10 x 1,25 kg x 3 cajas = $0,39 (igual que la base)', async (nav, base) => {
  const { pagina } = await abrir(nav, base);
  await esperarCatalogo(pagina);
  await sumar(pagina, '200', 3);
  await pagina.locator('#carrito').click();
  assert.match(await pagina.locator('#pedido-lineas .pedido-subtotal').innerText(), /0,39/);
});

caso('H11 Supabase colgado: entra el respaldo antes de 12 s', async (nav, base) => {
  const t0 = Date.now();
  const { pagina } = await abrir(nav, base, { supabase: 'colgado' });
  await pagina.locator('#grilla .pieza[data-id="105"]').waitFor({ timeout: 12000 });
  assert.ok(Date.now() - t0 < 12000);
});

caso('H12 Nota de 300 caracteres de emojis: el enlace no pasa el limite', async (nav, base) => {
  const { pagina } = await abrir(nav, base);
  await esperarCatalogo(pagina);
  await sumar(pagina, '300');
  await pagina.locator('#carrito').click();
  await pagina.locator('#pedido-nombre').fill('\u{1F600}'.repeat(200));
  await pagina.locator('#pedido-nota').fill('\u{1F600}'.repeat(200));
  const href = await pagina.locator('#pedido-enviar').getAttribute('href');
  assert.ok(href.split('?text=')[1].length <= 3500, 'largo ' + href.length);
  assert.strictEqual((await pagina.locator('#pedido-nota').inputValue()).length <= 300, true);
});

caso('H15 Dos pestanias: lo que suma una aparece en la otra', async (nav, base) => {
  const { pagina, contexto } = await abrir(nav, base);
  await esperarCatalogo(pagina);
  const otra = await contexto.newPage();
  await otra.goto(base + '/index.html');
  await esperarCatalogo(otra);
  await sumar(pagina, '300');
  await otra.waitForFunction(() => document.querySelector('#carrito-cuenta').textContent === '1');
  await sumar(otra, '105');
  await pagina.waitForFunction(() => document.querySelector('#carrito-cuenta').textContent === '2');
});

caso('H18 Filtro elegido sobre la cache se conserva al llegar el catalogo fresco', async (nav, base) => {
  const contexto = await nav.newContext({ serviceWorkers: 'block' });
  const p1 = await abrir(nav, base, { contexto });
  await esperarCatalogo(p1.pagina);
  await p1.pagina.close();
  // Segunda visita: pinta la cache y la red tarda 1,5 s
  await contexto.unrouteAll();
  const { pagina } = await abrir(nav, base, { contexto, demoraSupabase: 1500 });
  await esperarCatalogo(pagina);
  await pagina.locator('#chips .pista[data-categoria="Panificados"]').click();
  await pagina.waitForTimeout(2200);
  assert.strictEqual(await pagina.locator('#chips .pista.viva').getAttribute('data-categoria'), 'Panificados');
  assert.strictEqual(await pagina.locator('#grilla .pieza').count(), 1);
  await contexto.close();
});

// ── Ejecucion ──────────────────────────────────────────────────────────
(async () => {
  const s = await servidor();
  const base = 'http://127.0.0.1:' + s.address().port;
  const navegador = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  let fallas = 0;
  for (const c of casos) {
    try {
      await c.fn(navegador, base);
      console.log('  ok    ' + c.nombre);
    } catch (err) {
      fallas++;
      console.log('  FALLA ' + c.nombre + '\n        ' + String(err && err.message || err).split('\n').slice(0, 4).join('\n        '));
    }
  }
  await navegador.close();
  s.close();
  console.log('\n' + (casos.length - fallas) + '/' + casos.length + ' casos ok');
  process.exit(fallas ? 1 : 0);
})();
