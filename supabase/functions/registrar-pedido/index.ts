/**
 * Edge Function registrar-pedido  [AUDITORIA H03]
 * ---------------------------------------------------------------------------
 * Puerta verificada para registrar pedidos del catalogo:
 *   1. Verifica con Cloudflare el token de Turnstile que manda el sitio.
 *   2. Si es valido, llama a registrar_pedido_verificado con la clave
 *      service_role, pasando la IP real del cliente (el limite por IP de la
 *      base sigue funcionando).
 *
 * Secretos (Supabase > Edge Functions > Secrets):
 *   TURNSTILE_SECRET   clave secreta del widget de Turnstile (nunca en el sitio)
 * Los provee Supabase solo: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Opcional: ORIGENES_PERMITIDOS (separados por coma). Por defecto, el sitio
 * publicado en GitHub Pages.
 *
 * Sin TURNSTILE_SECRET responde 503: el sitio solo llama aca cuando tiene la
 * clave publica cargada en config.js.
 */

export type Entorno = {
  TURNSTILE_SECRET?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  ORIGENES_PERMITIDOS?: string;
};

const ORIGENES_POR_DEFECTO = 'https://oscarbiach.github.io';
const VERIFICAR_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function cabecerasCors(origen: string | null, entorno: Entorno): Record<string, string> {
  const permitidos = (entorno.ORIGENES_PERMITIDOS || ORIGENES_POR_DEFECTO)
    .split(',').map((o) => o.trim()).filter(Boolean);
  const cabeceras: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Vary': 'Origin',
  };
  if (origen && permitidos.indexOf(origen) > -1) cabeceras['Access-Control-Allow-Origin'] = origen;
  return cabeceras;
}

function json(cuerpo: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, cors),
  });
}

/** IP del cliente segun las cabeceras del proxy de Supabase. */
export function ipDelCliente(req: Request): string {
  const cf = (req.headers.get('cf-connecting-ip') || '').trim();
  if (cf) return cf;
  return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
}

export async function manejar(req: Request, entorno: Entorno, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const cors = cabecerasCors(req.headers.get('origin'), entorno);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ message: 'Metodo no permitido.', hint: 'metodo' }, 405, cors);

  if (!entorno.TURNSTILE_SECRET || !entorno.SUPABASE_URL || !entorno.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ message: 'La verificacion de pedidos no esta configurada.', hint: 'sin_configurar' }, 503, cors);
  }

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = await req.json();
  } catch {
    return json({ message: 'El pedido no tiene el formato esperado.', hint: 'formato' }, 400, cors);
  }
  const token = typeof cuerpo.token === 'string' ? cuerpo.token : '';
  if (!token || token.length > 2048) {
    return json({ message: 'Falta la verificacion anti-robots. Recarga la pagina e intenta de nuevo.', hint: 'verificacion' }, 403, cors);
  }

  const ip = ipDelCliente(req);

  // 1. Turnstile
  const datos = new URLSearchParams({ secret: entorno.TURNSTILE_SECRET, response: token });
  if (ip) datos.set('remoteip', ip);
  let verificado = false;
  try {
    const r = await fetchImpl(VERIFICAR_URL, { method: 'POST', body: datos });
    const v = await r.json();
    verificado = !!(v && v.success === true);
  } catch {
    return json({ message: 'No pudimos verificar el pedido. Intenta de nuevo en un momento.', hint: 'verificacion_caida' }, 502, cors);
  }
  if (!verificado) {
    return json({ message: 'No pudimos verificar que no sos un robot. Recarga la pagina e intenta de nuevo.', hint: 'verificacion' }, 403, cors);
  }

  // 2. Registro (la base valida todo lo demas y aplica el limite por IP)
  const clave = entorno.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetchImpl(entorno.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/registrar_pedido_verificado', {
    method: 'POST',
    headers: { apikey: clave, Authorization: 'Bearer ' + clave, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_ip: ip,
      p_ref: cuerpo.p_ref,
      p_cliente: cuerpo.p_cliente,
      p_nota: cuerpo.p_nota,
      p_items: cuerpo.p_items,
    }),
  });
  const texto = await r.text();
  let respuesta: unknown = null;
  try { respuesta = texto ? JSON.parse(texto) : null; } catch { respuesta = null; }
  if (r.ok) return json(respuesta, 200, cors);

  // Errores de validacion de la base: se pasan tal cual (mensaje y codigo),
  // sin detalles internos.
  const e = (respuesta || {}) as Record<string, unknown>;
  return json({ message: e.message || 'No pudimos registrar el pedido.', hint: e.hint || 'error' }, r.status, cors);
}

// En Supabase (Deno) se registra como servidor. En las pruebas (Node) no.
type DenoMinimo = {
  serve: (h: (req: Request) => Promise<Response>) => void;
  env: { get: (k: string) => string | undefined };
};
const deno = (globalThis as unknown as { Deno?: DenoMinimo }).Deno;
if (deno) {
  deno.serve((req) => manejar(req, {
    TURNSTILE_SECRET: deno.env.get('TURNSTILE_SECRET'),
    SUPABASE_URL: deno.env.get('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    ORIGENES_PERMITIDOS: deno.env.get('ORIGENES_PERMITIDOS'),
  }));
}
