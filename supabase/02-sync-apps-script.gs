/**
 * SINCRONIZAR LA PLANILLA CON SUPABASE
 * ---------------------------------------------------------------------------
 * Va en el proyecto de Apps Script donde ya esta el Web App del catalogo.
 * Copia lo que hay en la planilla a las tablas `productos` y `config`.
 *
 * ANTES DE USARLO
 *  1. En Apps Script: Configuracion del proyecto > Propiedades de la secuencia
 *     de comandos, crear dos propiedades:
 *        SUPABASE_URL          https://XXXX.supabase.co
 *        SUPABASE_SERVICE_KEY  la clave "service_role" del proyecto
 *     La service_role es SECRETA: da acceso total a la base. Va solo ahi.
 *     Nunca en config.js, ni en el repositorio, ni en un chat.
 *  2. Reemplazar armarCatalogo_() (abajo) por la funcion de tu script que
 *     arma el mismo objeto que hoy devuelve el Web App:
 *        { config: {...}, categorias: [...], marcas: [...], rubros: [...],
 *          productos: [{ id, sku, nombre, descripcion, categoria, marca,
 *                        precio, moneda, unidadesCaja, presentacion,
 *                        imagenes: [ids de Drive], rubros: [...],
 *                        destacado, nuevo, sinStock }] }
 *     Ese script no esta en el repositorio, por eso queda este punto a mano.
 *  3. Ejecutar sincronizarASupabase() una vez a mano y mirar el resultado en
 *     Ver > Registros. Despues se puede programar con un activador.
 *
 * QUE HACE
 *  - Inserta o actualiza cada producto por su id.
 *  - NO toca la columna `orden` (cuantas veces se pidio): la maneja la base.
 *  - Los productos que ya no estan en la planilla quedan `publicado = false`:
 *    salen del sitio pero no se borran ni se pierde su historia de pedidos.
 */

var LOTE_ = 500;

function sincronizarASupabase() {
  var datos = armarCatalogo_();
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('SUPABASE_URL');
  var clave = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !clave) throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en las propiedades del script.');
  if (!datos || !datos.productos || !datos.productos.length) {
    throw new Error('El catalogo llego vacio: no se sincroniza para no apagar todo el sitio.');
  }

  // La misma marca de tiempo para todo el lote: lo que no la tenga al final
  // es lo que salio de la planilla.
  var ahora = new Date().toISOString();

  var filas = datos.productos.map(function (p, i) {
    return {
      id: String(p.id),
      sku: p.sku || '',
      nombre: p.nombre || '',
      descripcion: p.descripcion || '',
      categoria: p.categoria || '',
      marca: p.marca || '',
      precio: (p.precio === '' || p.precio === undefined) ? null : p.precio,
      moneda: p.moneda || 'ARS',
      unidades_caja: p.unidadesCaja || 0,
      presentacion: p.presentacion || '',
      imagenes: p.imagenes || [],
      rubros: p.rubros || [],
      destacado: !!p.destacado,
      nuevo: !!p.nuevo,
      sin_stock: !!p.sinStock,
      posicion: i,
      publicado: true,
      actualizado_en: ahora
      // `orden` a proposito no va
    };
  });

  for (var d = 0; d < filas.length; d += LOTE_) {
    pedirSupabase_(url, clave, 'POST', 'productos?on_conflict=id', filas.slice(d, d + LOTE_), true);
  }

  // Lo que no se toco en esta corrida ya no esta en la planilla
  pedirSupabase_(url, clave, 'PATCH',
    'productos?actualizado_en=lt.' + encodeURIComponent(ahora) + '&publicado=eq.true',
    { publicado: false }, false);

  // Textos del sitio y listas
  var config = [];
  Object.keys(datos.config || {}).forEach(function (k) {
    config.push({ clave: k, valor: String(datos.config[k]) });
  });
  config.push({ clave: '_categorias', valor: JSON.stringify(datos.categorias || []) });
  config.push({ clave: '_marcas', valor: JSON.stringify(datos.marcas || []) });
  config.push({ clave: '_rubros', valor: JSON.stringify(datos.rubros || []) });
  pedirSupabase_(url, clave, 'POST', 'config?on_conflict=clave', config, true);

  Logger.log('Sincronizado: ' + filas.length + ' productos y ' + config.length + ' datos de config.');
}

function pedirSupabase_(url, clave, metodo, ruta, cuerpo, upsert) {
  var respuesta = UrlFetchApp.fetch(url + '/rest/v1/' + ruta, {
    method: metodo,
    contentType: 'application/json',
    headers: {
      apikey: clave,
      Authorization: 'Bearer ' + clave,
      Prefer: (upsert ? 'resolution=merge-duplicates,' : '') + 'return=minimal'
    },
    payload: JSON.stringify(cuerpo),
    muteHttpExceptions: true
  });
  var codigo = respuesta.getResponseCode();
  if (codigo < 200 || codigo >= 300) {
    throw new Error('Supabase respondio ' + codigo + ' en ' + ruta + ': ' + respuesta.getContentText().slice(0, 300));
  }
}

/** REEMPLAZAR por la funcion de tu script que arma el catalogo (ver arriba). */
function armarCatalogo_() {
  throw new Error('Falta conectar armarCatalogo_() con la funcion que arma el catalogo.');
}
