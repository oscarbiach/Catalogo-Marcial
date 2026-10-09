/* eslint-disable no-console */
/**
 * Pruebas de la Edge Function registrar-pedido (supabase/functions/), con
 * Cloudflare Turnstile y la base simulados. Node 22 ejecuta el .ts quitando
 * los tipos; no hace falta Deno.
 *
 *   node pruebas/unidad/registrar-pedido.test.mjs
 */
import assert from 'node:assert';
import { manejar, ipDelCliente } from '../../supabase/functions/registrar-pedido/index.ts';

const ENTORNO = {
  TURNSTILE_SECRET: 'secreto', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srk',
};
const ORIGEN = 'https://oscarbiach.github.io';

function pedido(cuerpo, cabeceras = {}) {
  return new Request('https://x.supabase.co/functions/v1/registrar-pedido', {
    method: 'POST',
    headers: Object.assign({ origin: ORIGEN, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }, cabeceras),
    body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
  });
}

/** fetch falso: registra las llamadas y responde segun la URL. */
function fetchFalso({ turnstile = { success: true }, base = { status: 200, body: { id: 'p1', total: 500 } } } = {}) {
  const llamadas = [];
  const f = async (url, opciones) => {
    llamadas.push({ url: String(url), opciones });
    if (String(url).includes('turnstile')) return new Response(JSON.stringify(turnstile));
    return new Response(JSON.stringify(base.body), { status: base.status });
  };
  return { f, llamadas };
}

const CUERPO = { token: 'tok', p_ref: '11111111-1111-1111-1111-111111111111', p_cliente: 'Cli', p_nota: '', p_items: [{ id: '300', cantidad: 1 }] };
const casos = [];
const caso = (n, fn) => casos.push([n, fn]);

caso('Token valido: verifica con la IP real y registra con service_role', async () => {
  const { f, llamadas } = fetchFalso();
  const r = await manejar(pedido(CUERPO), ENTORNO, f);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('access-control-allow-origin'), ORIGEN);
  const verif = new URLSearchParams(String(llamadas[0].opciones.body));
  assert.deepStrictEqual([verif.get('secret'), verif.get('response'), verif.get('remoteip')], ['secreto', 'tok', '203.0.113.5']);
  assert.match(llamadas[1].url, /rpc\/registrar_pedido_verificado$/);
  assert.strictEqual(llamadas[1].opciones.headers.Authorization, 'Bearer srk');
  const enviado = JSON.parse(llamadas[1].opciones.body);
  assert.strictEqual(enviado.p_ip, '203.0.113.5');
  assert.strictEqual(enviado.token, undefined);   // el token no viaja a la base
});

caso('Token rechazado por Cloudflare: 403 y no se registra nada', async () => {
  const { f, llamadas } = fetchFalso({ turnstile: { success: false } });
  const r = await manejar(pedido(CUERPO), ENTORNO, f);
  assert.strictEqual(r.status, 403);
  assert.strictEqual((await r.json()).hint, 'verificacion');
  assert.strictEqual(llamadas.length, 1);
});

caso('Sin token: 403 sin llamar a nadie', async () => {
  const { f, llamadas } = fetchFalso();
  const r = await manejar(pedido(Object.assign({}, CUERPO, { token: '' })), ENTORNO, f);
  assert.strictEqual(r.status, 403);
  assert.strictEqual(llamadas.length, 0);
});

caso('Sin secreto configurado: 503', async () => {
  const { f } = fetchFalso();
  const r = await manejar(pedido(CUERPO), Object.assign({}, ENTORNO, { TURNSTILE_SECRET: '' }), f);
  assert.strictEqual(r.status, 503);
});

caso('Error de validacion de la base: se pasa mensaje y codigo, con su estado', async () => {
  const { f } = fetchFalso({ base: { status: 429, body: { message: 'Recibimos muchos pedidos seguidos.', hint: 'demasiados_pedidos', details: 'interno' } } });
  const r = await manejar(pedido(CUERPO), ENTORNO, f);
  assert.strictEqual(r.status, 429);
  assert.deepStrictEqual(await r.json(), { message: 'Recibimos muchos pedidos seguidos.', hint: 'demasiados_pedidos' });
});

caso('Origen ajeno: sin cabecera CORS (el navegador lo bloquea)', async () => {
  const { f } = fetchFalso();
  const r = await manejar(pedido(CUERPO, { origin: 'https://otro.sitio' }), ENTORNO, f);
  assert.strictEqual(r.headers.get('access-control-allow-origin'), null);
});

caso('Preflight OPTIONS responde 204 con CORS', async () => {
  const r = await manejar(new Request('https://x/f', { method: 'OPTIONS', headers: { origin: ORIGEN } }), ENTORNO);
  assert.strictEqual(r.status, 204);
  assert.strictEqual(r.headers.get('access-control-allow-origin'), ORIGEN);
});

caso('JSON roto: 400', async () => {
  const { f } = fetchFalso();
  const r = await manejar(pedido('{no es json'), ENTORNO, f);
  assert.strictEqual(r.status, 400);
});

caso('ipDelCliente prefiere cf-connecting-ip', () => {
  const r = new Request('https://x', { headers: { 'cf-connecting-ip': '198.51.100.1', 'x-forwarded-for': '203.0.113.5' } });
  assert.strictEqual(ipDelCliente(r), '198.51.100.1');
});

let fallas = 0;
for (const [nombre, fn] of casos) {
  try { await fn(); console.log('  ok    ' + nombre); } catch (err) { fallas++; console.log('  FALLA ' + nombre + '\n        ' + err.message.split('\n')[0]); }
}
console.log('\n' + (casos.length - fallas) + '/' + casos.length + ' casos ok');
process.exit(fallas ? 1 : 0);
