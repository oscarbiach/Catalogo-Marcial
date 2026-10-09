/* ===========================================================================
   Contrato del catalogo
   ---------------------------------------------------------------------------
   Logica pura, sin DOM ni red: valida y normaliza lo que llega de Supabase,
   de Apps Script o de la cache, y aplica las reglas de caja cerrada. Se
   prueba directo en Node (pruebas/unidad/).
   =========================================================================== */

/** Version del formato guardado en la cache del navegador. */
export const ESQUEMA_CACHE = 2;

/**
 * @typedef {Object} Producto
 * @property {string}   id
 * @property {string}   sku
 * @property {string}   nombre
 * @property {string}   descripcion
 * @property {string}   categoria
 * @property {string}   marca
 * @property {?number}  precio        null = sin precio
 * @property {string}   moneda
 * @property {number}   unidadesCaja
 * @property {boolean}  soloCaja      se vende solo por caja cerrada
 * @property {number}   kgCaja        kilos de la caja (precio por kg)
 * @property {string}   presentacion
 * @property {''|'kg'|'unidad'|'caja'} unidadPrecio
 * @property {string[]} imagenes
 * @property {string[]} rubros
 * @property {boolean}  destacado
 * @property {boolean}  nuevo
 * @property {boolean}  sinStock
 * @property {number}   orden
 * @property {string}   tipo
 * @property {string}   heno          texto de busqueda ya normalizado
 *
 * @typedef {Object} Catalogo
 * @property {true}     ok
 * @property {number}   esquema
 * @property {'supabase'|'apps-script'} fuente
 * @property {?number}  version
 * @property {?number}  sincronizadoEn  ultima sincronizacion buena (ms)
 * @property {number}   obtenidoEn      cuando lo trajo este navegador (ms)
 * @property {'completas'|'heredadas'|'faltan'} reglasCaja
 * @property {number}   contrato        2 = la fuente trae soloCaja/kgCaja propios
 * @property {Object<string,string>} config
 * @property {string[]} categorias
 * @property {string[]} marcas
 * @property {string[]} rubros
 * @property {Producto[]} productos
 */

// Rango de marcas diacriticas de Unicode (U+0300 a U+036F). Se arma con
// fromCharCode para que el archivo no contenga caracteres invisibles.
export const ACENTOS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');

/** Quita acentos y pasa a minusculas, para que la busqueda sea tolerante. */
export function normalizar(texto) {
  return String(texto || '').toLowerCase().normalize('NFD').replace(ACENTOS, '');
}

/**
 * [AUDITORIA H09] Redondeo decimal a centavos, mitad hacia arriba, igual que
 * round(numeric, 2) de Postgres. Pasa por notacion exponencial para no
 * arrastrar el error binario (1.005 * 100 = 100.49999...).
 * @param {number} valor
 * @returns {number}
 */
export function redondear2(valor) {
  if (!isFinite(valor)) return valor;
  var signo = valor < 0 ? -1 : 1;
  return signo * Number(Math.round(Number(Math.abs(valor) + 'e2')) + 'e-2');
}

export function comoTexto(v) {
  return v === null || v === undefined ? '' : String(v);
}

export function comoNumero(v, porDefecto) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return porDefecto;
  var n = Number(v);
  return isFinite(n) ? n : porDefecto;
}

export function comoBooleano(v) {
  return v === true || v === 1 || /^(true|t|1|si|yes)$/i.test(comoTexto(v).trim());
}

export function comoListaDeTextos(v) {
  if (!Array.isArray(v)) return [];
  return v.map(function (x) {
    if (typeof x === 'string' || typeof x === 'number') return String(x).trim();
    if (x && typeof x === 'object') return comoTexto(x.nombre || x.id).trim();
    return '';
  }).filter(Boolean);
}

/**
 * [AUDITORIA H05] Valida y normaliza un catalogo, venga de la red o de la
 * cache. Lo estructural (sin ok, sin array de productos, sin config) se
 * rechaza; un producto suelto mal formado se descarta sin tumbar al resto.
 * Nunca deja pasar NaN, Infinity ni tipos inesperados a la pantalla.
 * @param {*} crudo
 * @param {'supabase'|'apps-script'} fuente
 * @returns {Catalogo}
 */
export function normalizarCatalogo(crudo, fuente) {
  if (!crudo || typeof crudo !== 'object' || crudo.ok !== true) {
    throw new Error('La respuesta del catalogo no tiene el formato esperado.');
  }
  if (!Array.isArray(crudo.productos)) throw new Error('El catalogo no trae la lista de productos.');
  if (!crudo.config || typeof crudo.config !== 'object' || Array.isArray(crudo.config)) {
    throw new Error('El catalogo no trae la configuracion.');
  }

  var config = {};
  Object.keys(crudo.config).forEach(function (k) {
    var v = crudo.config[k];
    if (v === null || typeof v !== 'object') config[k] = comoTexto(v);
  });

  var vistos = Object.create(null);
  var productos = [];
  crudo.productos.forEach(function (p) {
    if (!p || typeof p !== 'object') return;
    var id = comoTexto(p.id).trim();
    var nombre = comoTexto(p.nombre).trim();
    if (!id || !nombre || vistos[id]) return;
    vistos[id] = true;

    var precio = comoNumero(p.precio, null);
    if (precio !== null && precio < 0) precio = null;
    var unidad = comoTexto(p.unidadPrecio).trim().toLowerCase();

    /** @type {Producto} */
    var limpio = {
      id: id,
      sku: comoTexto(p.sku),
      nombre: nombre,
      descripcion: comoTexto(p.descripcion),
      categoria: comoTexto(p.categoria),
      marca: comoTexto(p.marca),
      precio: precio,
      moneda: /^[A-Z]{3}$/.test(comoTexto(p.moneda)) ? p.moneda : 'ARS',
      unidadesCaja: Math.max(0, Math.floor(comoNumero(p.unidadesCaja, 0))),
      soloCaja: comoBooleano(p.soloCaja),
      kgCaja: Math.max(0, comoNumero(p.kgCaja, 0)),
      presentacion: comoTexto(p.presentacion),
      unidadPrecio: unidad === 'kg' || unidad === 'unidad' || unidad === 'caja' ? unidad : '',
      imagenes: comoListaDeTextos(p.imagenes),
      rubros: comoListaDeTextos(p.rubros),
      destacado: comoBooleano(p.destacado),
      nuevo: comoBooleano(p.nuevo),
      sinStock: comoBooleano(p.sinStock),
      orden: comoNumero(p.orden, 0),
      tipo: comoTexto(p.tipo),
      heno: '',
    };
    // [AUDITORIA H16] El texto de busqueda se normaliza una sola vez.
    limpio.heno = normalizar([limpio.nombre, limpio.sku, limpio.marca, limpio.categoria,
      limpio.presentacion, limpio.descripcion].join(' '));
    productos.push(limpio);
  });
  if (!productos.length) throw new Error('El catalogo llego sin productos validos.');

  var sincronizadoEn = comoNumero(crudo.sincronizadoEn, null);

  /** @type {Catalogo} */
  var datos = {
    ok: true,
    esquema: ESQUEMA_CACHE,
    fuente: fuente === 'supabase' ? 'supabase' : 'apps-script',
    version: comoNumero(crudo.version, null),
    sincronizadoEn: sincronizadoEn,
    obtenidoEn: comoNumero(crudo.obtenidoEn, Date.now()),
    reglasCaja: crudo.reglasCaja === 'heredadas' || crudo.reglasCaja === 'faltan' ? crudo.reglasCaja : 'completas',
    contrato: Math.max(1, Math.floor(comoNumero(crudo.contrato, 1))),
    config: config,
    categorias: comoListaDeTextos(crudo.categorias),
    marcas: comoListaDeTextos(crudo.marcas),
    rubros: comoListaDeTextos(crudo.rubros),
    productos: productos,
  };
  return datos;
}

/**
 * [AUDITORIA H01] Aplica al catalogo del respaldo las reglas de caja cerrada
 * guardadas de la ultima lectura de Supabase. Sin reglas confiables (null), el
 * catalogo queda marcado 'faltan' y el sitio pasa a modo consulta.
 * @param {Catalogo} datos
 * @param {?Object<string, {u: number, kg: number}>} reglas
 * @returns {Catalogo}
 */
export function aplicarReglasCaja(datos, reglas) {
  if (!reglas) {
    datos.reglasCaja = 'faltan';
    return datos;
  }
  datos.productos.forEach(function (p) {
    var r = reglas[p.id];
    if (!r) { p.soloCaja = false; p.kgCaja = 0; return; }
    p.soloCaja = true;
    var u = Math.floor(comoNumero(r.u, 0));
    if (u > 1 && !(p.unidadesCaja > 1)) p.unidadesCaja = u;
    p.kgCaja = Math.max(0, comoNumero(r.kg, 0));
  });
  datos.reglasCaja = 'heredadas';
  return datos;
}
