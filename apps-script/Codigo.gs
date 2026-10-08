/**
 * Catalogo web - backend
 * ---------------------------------------------------------------------------
 * Este script cumple tres roles:
 *   1. API publica (JSON) que consume la landing hosteada en GitHub Pages.
 *   2. Panel de administracion (HTML) para cargar y editar productos.
 *   3. Capa de acceso a la planilla de Google Sheets que hace de base de datos.
 *
 * Para instalarlo por primera vez, ejecutar la funcion instalar() desde el
 * editor. Ver README.md en la raiz del proyecto.
 */

const CFG = {
  HOJA_PRODUCTOS: 'Productos',
  HOJA_CONFIG: 'Config',
  CARPETA_IMAGENES: 'Catalogo - Imagenes',
  CACHE_CATALOGO: 'catalogo_json_v1',
  CACHE_SEGUNDOS: 300,      // 5 min de cache del JSON publico
  SESION_SEGUNDOS: 21600,   // 6 h de sesion en el panel (maximo de CacheService)
  PROP_HASH: 'ADMIN_HASH',
  PROP_SALT: 'ADMIN_SALT',
  PROP_CARPETA: 'CARPETA_ID',
  PROP_PLANILLA: 'PLANILLA_ID',
  // Lo pone cc_aplicar() (CajaCerrada.gs) cuando las reglas de caja cerrada ya
  // estan cargadas en la planilla. Recien ahi el catalogo las publica como
  // fuente de verdad (contrato 2).
  PROP_CAJA_EN_PLANILLA: 'CAJA_EN_PLANILLA',
};

/**
 * Orden y nombre de las columnas de la hoja Productos. No reordenar a mano:
 * la hoja se lee por posicion. Las columnas nuevas van siempre al final.
 */
const COLUMNAS = [
  'id', 'sku', 'nombre', 'descripcion', 'categoria', 'marca',
  'precio', 'moneda', 'unidades_caja', 'presentacion', 'imagenes',
  'destacado', 'nuevo', 'sin_stock', 'orden', 'activo', 'actualizado', 'pedidos',
  'rubros', 'codigo_precio','unidad_precio',
  // [AUDITORIA H01] Venta solo por caja cerrada. solo_caja: si/no. kg_caja:
  // kilos de la caja cuando el precio es por kg (las unidades salen de
  // unidades_caja). Antes esta regla vivia solo en Supabase y el respaldo de
  // Apps Script la perdia.
  'solo_caja', 'kg_caja',
];

/** Claves de la hoja Config, con sus valores por defecto. */
const CONFIG_DEFAULTS = {
  negocio_nombre: 'Mi Distribuidora',
  negocio_bajada: 'Catalogo mayorista de productos',
  banner_titulo: 'Tu pedido, en camino',
  negocio_logo_url: '',
  whatsapp: '',
  whatsapp_mensaje: 'Hola! Quiero consultar por este producto:',
  email: '',
  telefono: '',
  direccion: '',
  instagram: '',
  color_marca: '#c8452b',
  // Rubros del cliente: a que tipo de comercio le sirve cada producto. Van
  // separados por coma y se editan desde el panel, asi sumar uno nuevo no pide
  // tocar codigo. Un producto puede estar en varios: una caja de pan sirve
  // igual a una hamburgueseria que a una rotiseria.
  rubros: 'Hamburgueseria, Pizzeria, Mercado, Rotiseria',
  mostrar_precios: 'si',
  pedidos_activos: 'si',
  nota_precios: 'Precios sujetos a modificacion sin previo aviso.',
};


// ---------------------------------------------------------------------------
// Instalacion
// ---------------------------------------------------------------------------

/**
 * Devuelve la planilla con la que trabaja el catalogo.
 *
 * Normalmente es la planilla a la que esta unido el script (cuando se abrio
 * desde Extensiones > Apps Script). Si el script se creo suelto, desde
 * script.google.com, no hay planilla activa: en ese caso se usa el id que haya
 * guardado usarPlanilla().
 */
function obtenerPlanilla() {
  const activa = SpreadsheetApp.getActiveSpreadsheet();
  if (activa) return activa;

  const id = PropertiesService.getScriptProperties().getProperty(CFG.PROP_PLANILLA);
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (err) {
      throw new Error('El id de planilla guardado ya no sirve: ' + err.message);
    }
  }

  throw new Error(
    'Este script no esta unido a ninguna planilla. Tenes dos opciones: ' +
    'abrir el script desde Extensiones > Apps Script de tu planilla, o ' +
    'ejecutar usarPlanilla("ID_DE_LA_PLANILLA") una vez. El id es la parte ' +
    'larga de la URL de la planilla, entre /d/ y /edit.');
}

/**
 * Ata este script a una planilla por id. Solo hace falta si creaste el
 * proyecto suelto en script.google.com en lugar de abrirlo desde la planilla.
 */
function usarPlanilla(id) {
  const planilla = SpreadsheetApp.openById(String(id || '').trim());
  PropertiesService.getScriptProperties().setProperty(CFG.PROP_PLANILLA, planilla.getId());
  const mensaje = 'Listo, el catalogo va a usar la planilla "' + planilla.getName() + '".';
  Logger.log(mensaje);
  return mensaje;
}

/**
 * Cuenta que encontro y que falta. Sirve para saber en que estado quedo la
 * instalacion sin tener que adivinar. No modifica nada.
 */
function diagnostico() {
  const lineas = [];
  const props = PropertiesService.getScriptProperties();

  let planilla = null;
  try {
    planilla = obtenerPlanilla();
    lineas.push('Planilla ......... ' + planilla.getName());
    lineas.push('Hojas que tiene .. ' + planilla.getSheets().map(function (h) {
      return h.getName();
    }).join(', '));
    lineas.push('Hoja Productos ... ' + (planilla.getSheetByName(CFG.HOJA_PRODUCTOS) ? 'OK' : 'FALTA'));
    lineas.push('Hoja Config ...... ' + (planilla.getSheetByName(CFG.HOJA_CONFIG) ? 'OK' : 'FALTA'));
  } catch (err) {
    lineas.push('Planilla ......... ERROR: ' + err.message);
  }

  lineas.push('Clave del panel .. ' + (props.getProperty(CFG.PROP_HASH) ? 'definida' : 'FALTA (paso 4)'));

  const carpeta = props.getProperty(CFG.PROP_CARPETA);
  lineas.push('Carpeta de fotos . ' + (carpeta ? 'OK (' + carpeta + ')' : 'FALTA'));

  // Si falta alguno, es que ese archivo no se creo o quedo vacio.
  lineas.push('Codigo.gs ........ ' + (typeof instalar === 'function' ? 'OK' : 'FALTA'));
  lineas.push('Productos.gs ..... ' + (typeof guardarProducto === 'function' ? 'OK' : 'FALTA'));
  lineas.push('Imagenes.gs ...... ' + (typeof subirImagen === 'function' ? 'OK' : 'FALTA'));

  const texto = lineas.join('\n');
  Logger.log(texto);
  return texto;
}

/**
 * Prepara la planilla, la carpeta de imagenes y avisa si falta la clave.
 * Ejecutar una sola vez, a mano, desde el editor de Apps Script.
 */
function instalar() {
  const ss = obtenerPlanilla();

  // Hoja de productos
  let hoja = ss.getSheetByName(CFG.HOJA_PRODUCTOS);
  if (!hoja) hoja = ss.insertSheet(CFG.HOJA_PRODUCTOS);
  hoja.getRange(1, 1, 1, COLUMNAS.length).setValues([COLUMNAS])
      .setFontWeight('bold').setBackground('#eef1f5');
  hoja.setFrozenRows(1);

  // Hoja de configuracion
  let cfgHoja = ss.getSheetByName(CFG.HOJA_CONFIG);
  if (!cfgHoja) {
    cfgHoja = ss.insertSheet(CFG.HOJA_CONFIG);
    cfgHoja.getRange(1, 1, 1, 2).setValues([['clave', 'valor']])
           .setFontWeight('bold').setBackground('#eef1f5');
    cfgHoja.setFrozenRows(1);
    cfgHoja.setColumnWidth(1, 200);
    cfgHoja.setColumnWidth(2, 480);
  }

  // Agrega las claves de configuracion que falten, sin pisar las ya cargadas.
  // Asi, volver a ejecutar instalar() despues de una actualizacion suma lo nuevo.
  const yaEstan = {};
  if (cfgHoja.getLastRow() >= 2) {
    cfgHoja.getRange(2, 1, cfgHoja.getLastRow() - 1, 1).getValues().forEach(function (fila) {
      const clave = String(fila[0]).trim();
      if (clave) yaEstan[clave] = true;
    });
  }
  const faltantes = Object.keys(CONFIG_DEFAULTS)
    .filter(function (k) { return !yaEstan[k]; })
    .map(function (k) { return [k, CONFIG_DEFAULTS[k]]; });
  if (faltantes.length) {
    cfgHoja.getRange(cfgHoja.getLastRow() + 1, 1, faltantes.length, 2).setValues(faltantes);
  }

  // Carpeta de imagenes en Drive
  obtenerCarpetaImagenes();

  const yaTieneClave = !!PropertiesService.getScriptProperties().getProperty(CFG.PROP_HASH);

  const mensaje = yaTieneClave
    ? 'Listo. La planilla ya estaba configurada y la clave del panel sigue vigente.'
    : 'Listo. Ahora ejecuta definirClaveAdmin("tu-clave-secreta") para habilitar el panel.';

  Logger.log(mensaje);
  return mensaje;
}

/**
 * ATAJO PARA CONFIGURAR LA CLAVE
 * ---------------------------------------------------------------------------
 * El editor de Apps Script no permite ejecutar una funcion pasandole
 * parametros. Asi que: escribi tu clave abajo, ejecuta esta funcion una vez,
 * y despues volve a dejar el texto de ejemplo y guarda.
 *
 * La clave no queda en el codigo: se guarda hasheada en las propiedades del
 * script. Aun asi, no conviene dejarla escrita aca.
 */
function CONFIGURAR_CLAVE() {
  definirClaveAdmin('cambiame-por-una-clave-larga');
}

/**
 * Define (o cambia) la clave del panel de administracion.
 * La clave nunca se guarda en texto plano: se almacena su hash SHA-256 con sal.
 */
function definirClaveAdmin(clave) {
  if (!clave || String(clave).length < 8) {
    throw new Error('La clave debe tener al menos 8 caracteres.');
  }
  const props = PropertiesService.getScriptProperties();
  const sal = Utilities.getUuid();
  props.setProperty(CFG.PROP_SALT, sal);
  props.setProperty(CFG.PROP_HASH, hashClave(String(clave), sal));
  Logger.log('Clave actualizada.');
  return 'Clave actualizada.';
}

function hashClave(clave, sal) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, sal + '|' + clave, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    return ('0' + (b & 0xff).toString(16)).slice(-2);
  }).join('');
}
// ---------------------------------------------------------------------------
// Enrutado del Web App
// ---------------------------------------------------------------------------

/**
 * Punto de entrada HTTP.
 *   ?action=catalog -> JSON con todo el catalogo (lo consume GitHub Pages)
 *   ?action=ping    -> chequeo de vida
 *   sin action      -> panel de administracion
 */
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';

  if (action === 'catalog') {
    return responderJson(obtenerCatalogoCacheado());
  }
  if (action === 'ping') {
    return responderJson({ ok: true, ts: Date.now() });
  }

  return HtmlService.createTemplateFromFile('Admin')
    .evaluate()
    .setTitle('Panel de catalogo')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Permite incluir archivos HTML parciales desde las plantillas. */
function include(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}

function responderJson(objeto) {
  return ContentService
    .createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// Sesion del panel
// ---------------------------------------------------------------------------

/**
 * Valida la clave y devuelve un token de sesion.
 * El token vive en CacheService del lado del servidor: el cliente solo guarda
 * el token, nunca la clave.
 */
function iniciarSesion(clave) {
  const props = PropertiesService.getScriptProperties();
  const hashGuardado = props.getProperty(CFG.PROP_HASH);
  const sal = props.getProperty(CFG.PROP_SALT);

  if (!hashGuardado || !sal) {
    throw new Error('El panel todavia no tiene clave. Ejecuta definirClaveAdmin() desde el editor.');
  }

  Utilities.sleep(400); // pequenio freno contra fuerza bruta

  if (hashClave(String(clave || ''), sal) !== hashGuardado) {
    throw new Error('Clave incorrecta.');
  }

  const token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('sesion_' + token, '1', CFG.SESION_SEGUNDOS);
  return { token: token, expiraEn: CFG.SESION_SEGUNDOS };
}

function cerrarSesion(token) {
  CacheService.getScriptCache().remove('sesion_' + token);
  return true;
}

/** Lanza una excepcion si el token no corresponde a una sesion viva. */
function exigirSesion(token) {
  if (!token || CacheService.getScriptCache().get('sesion_' + token) !== '1') {
    throw new Error('SESION_EXPIRADA');
  }
}

// ---------------------------------------------------------------------------
// Catalogo publico
// ---------------------------------------------------------------------------

// CacheService no admite valores de mas de 100 KB. Como el catalogo ya ronda
// los 90 KB, se guarda partido en varios trozos: asi sigue cacheado aunque el
// catalogo siga creciendo, en vez de perder el cache de golpe al pasar el
// limite y volverse lento para todos.
const CACHE_TROZO = 80000;
const CACHE_MAX_TROZOS = 8;   // hasta ~640 KB de catalogo

/** Devuelve el catalogo desde cache, o lo reconstruye si vencio. */
function obtenerCatalogoCacheado() {
  const cache = CacheService.getScriptCache();

  const guardado = leerCachePartido(cache);
  if (guardado) {
    try {
      return JSON.parse(guardado);
    } catch (err) {
      // cache corrupto: se regenera abajo
    }
  }

  const catalogo = construirCatalogo();
  guardarCachePartido(cache, JSON.stringify(catalogo));
  return catalogo;
}

function guardarCachePartido(cache, texto) {
  const trozos = [];
  for (let i = 0; i < texto.length; i += CACHE_TROZO) {
    trozos.push(texto.slice(i, i + CACHE_TROZO));
  }
  // Catalogo enorme: se sirve igual, solo que sin cache.
  if (trozos.length > CACHE_MAX_TROZOS) return;

  const mapa = {};
  trozos.forEach(function (trozo, i) { mapa[CFG.CACHE_CATALOGO + '_' + i] = trozo; });
  mapa[CFG.CACHE_CATALOGO + '_n'] = String(trozos.length);
  cache.putAll(mapa, CFG.CACHE_SEGUNDOS);
}

function leerCachePartido(cache) {
  const n = parseInt(cache.get(CFG.CACHE_CATALOGO + '_n'), 10);
  if (!n) return null;

  const claves = [];
  for (let i = 0; i < n; i++) claves.push(CFG.CACHE_CATALOGO + '_' + i);
  const partes = cache.getAll(claves);

  let texto = '';
  for (let i = 0; i < n; i++) {
    const parte = partes[CFG.CACHE_CATALOGO + '_' + i];
    // Si vencio un solo trozo, el conjunto ya no sirve: se reconstruye entero.
    if (parte === undefined || parte === null) return null;
    texto += parte;
  }
  return texto;
}

function invalidarCache() {
  const cache = CacheService.getScriptCache();
  const n = parseInt(cache.get(CFG.CACHE_CATALOGO + '_n'), 10) || 0;
  const claves = [CFG.CACHE_CATALOGO + '_n'];
  for (let i = 0; i < n; i++) claves.push(CFG.CACHE_CATALOGO + '_' + i);
  cache.removeAll(claves);
}

/** Arma el objeto que consume la landing: solo productos activos. */
function construirCatalogo() {
  const productos = leerProductos().filter(function (p) { return p.activo; });
  const marcas = [];
  const demanda = {};   // categoria -> pedidos sumados

  productos.forEach(function (p) {
    if (p.categoria) demanda[p.categoria] = (demanda[p.categoria] || 0) + (p.pedidos || 0);
    if (p.marca && marcas.indexOf(p.marca) === -1) marcas.push(p.marca);
  });

  const porNombre = function (a, b) { return a.localeCompare(b, 'es'); };
  marcas.sort(porNombre);

  // Las categorias salen ordenadas por lo que se pide en cada una, de mayor a
  // menor. Viaja el orden, nunca los numeros: cuanto se pide de cada cosa es
  // informacion comercial y no tiene por que llegar al navegador del cliente.
  // Las que empatan en cero se ordenan por nombre para que el listado no
  // cambie de un dia para el otro sin motivo.
  const categorias = Object.keys(demanda).sort(function (a, b) {
    return (demanda[b] - demanda[a]) || porNombre(a, b);
  });

  // Los rubros se cargan como texto en la Config para que sumar uno no pida
  // tocar codigo. Se parten aca y no en el navegador para que el sitio reciba
  // una lista limpia y en el orden que puso el usuario.
  const config = leerConfig();
  const rubros = String(config.rubros || '')
    .split(',')
    .map(function (r) { return r.trim(); })
    .filter(Boolean);

  const logoId = buscarLogoEnDrive();
  if (logoId) config.negocio_logo_id = logoId;

  // [AUDITORIA H01] contrato 2 = cada producto trae soloCaja y kgCaja y la
  // planilla es la fuente de verdad de la venta por caja. Mientras no se haya
  // corrido cc_aplicar(), las columnas estan vacias y se sigue en contrato 1:
  // asi Supabase no toma un "nadie se vende por caja" que en realidad es
  // "todavia no se cargo".
  const contrato = PropertiesService.getScriptProperties()
    .getProperty(CFG.PROP_CAJA_EN_PLANILLA) === '1' ? 2 : 1;

  return {
    ok: true,
    contrato: contrato,
    version: Date.now(),
    config: config,
    categorias: categorias,
    marcas: marcas,
    rubros: rubros,
    productos: productos.map(despublicar),
  };
}

/** Recorta el producto a los campos que le interesan al sitio publico. */
function despublicar(p) {
  return {
    id: p.id,
    sku: p.sku,
    nombre: p.nombre,
    descripcion: p.descripcion,
    categoria: p.categoria,
    marca: p.marca,
    precio: p.precio,
    moneda: p.moneda,
    unidadesCaja: p.unidades_caja,
    presentacion: p.presentacion,
    imagenes: p.imagenes,
    destacado: p.destacado,
    nuevo: p.nuevo,
    sinStock: p.sin_stock,
    orden: p.orden,
    rubros: p.rubros,
    unidadPrecio: p.unidad_precio,
    soloCaja: p.solo_caja,
    kgCaja: p.kg_caja,
    // A proposito NO se manda 'pedidos': es informacion comercial. El catalogo
    // ya viaja ordenado por ese criterio desde el servidor, asi que el sitio
    // no necesita conocer el numero para mostrar lo mas pedido primero.
  };
}
