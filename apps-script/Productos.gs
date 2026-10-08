/**
 * Acceso a datos: hoja Productos y hoja Config.
 * ---------------------------------------------------------------------------
 * Todas las funciones que escriben toman un lock para que dos personas
 * editando al mismo tiempo no se pisen, e invalidan el cache del catalogo.
 */

function hojaProductos() {
  const hoja = obtenerPlanilla().getSheetByName(CFG.HOJA_PRODUCTOS);
  if (!hoja) throw new Error('Falta la hoja "' + CFG.HOJA_PRODUCTOS + '". Ejecuta instalar().');
  asegurarEncabezado(hoja);
  return hoja;
}

// Se comprueba una sola vez por ejecucion: no tiene sentido preguntarlo en
// cada lectura.
let encabezadoVerificado = false;

/**
 * Completa el encabezado si el codigo agrego columnas nuevas desde la ultima
 * vez. Los datos viejos no se tocan: las columnas nuevas quedan vacias y se
 * leen como cero. Sin esto, cada version que suma una columna obligaria a
 * ejecutar instalar() a mano.
 */
function asegurarEncabezado(hoja) {
  if (encabezadoVerificado) return;
  encabezadoVerificado = true;

  if (hoja.getLastColumn() >= COLUMNAS.length) return;

  hoja.getRange(1, 1, 1, COLUMNAS.length).setValues([COLUMNAS])
      .setFontWeight('bold').setBackground('#eef1f5');
}

function hojaConfig() {
  const hoja = obtenerPlanilla().getSheetByName(CFG.HOJA_CONFIG);
  if (!hoja) throw new Error('Falta la hoja "' + CFG.HOJA_CONFIG + '". Ejecuta instalar().');
  return hoja;
}

// ---------------------------------------------------------------------------
// Conversiones
// ---------------------------------------------------------------------------

function aBool(valor) {
  if (valor === true) return true;
  if (valor === false || valor === '' || valor === null || valor === undefined) return false;
  const t = String(valor).trim().toLowerCase();
  return t === 'true' || t === 'si' || t === 'sí' || t === '1' || t === 'x';
}

/**
 * Interpreta un numero escrito de cualquiera de las formas que aparecen en una
 * lista de precios: "1850", "$ 2.790", "1.234,56", "1450.50", "1,234.56".
 *
 * Regla para un solo tipo de separador: si todos los grupos que siguen al
 * separador tienen exactamente tres digitos, es separador de miles
 * ("2.790" -> 2790). Si no, es el separador decimal ("1450,50" -> 1450.5).
 * O sea que "0.500" se lee como 500, no como medio: en una columna de precios
 * es lo correcto, pero conviene no usar aNumero para pesos o volumenes.
 */
function aNumero(valor) {
  if (valor === '' || valor === null || valor === undefined) return null;
  if (typeof valor === 'number') return valor;

  const limpio = String(valor).replace(/[^0-9,.\-]/g, '');
  if (!limpio) return null;

  const tieneComa = limpio.indexOf(',') > -1;
  const tienePunto = limpio.indexOf('.') > -1;
  let normalizado;

  if (tieneComa && tienePunto) {
    // Con ambos separadores, el decimal es el que esta mas a la derecha.
    normalizado = limpio.lastIndexOf(',') > limpio.lastIndexOf('.')
      ? limpio.replace(/\./g, '').replace(',', '.')
      : limpio.replace(/,/g, '');
  } else if (tieneComa || tienePunto) {
    const sep = tieneComa ? ',' : '.';
    const grupos = limpio.split(sep);
    const todosDeTres = grupos.slice(1).every(function (g) { return /^\d{3}$/.test(g); });

    if (todosDeTres) {
      normalizado = grupos.join('');
    } else {
      const ultimo = limpio.lastIndexOf(sep);
      normalizado = limpio.slice(0, ultimo).split(sep).join('') + '.' + limpio.slice(ultimo + 1);
    }
  } else {
    normalizado = limpio;
  }

  const n = parseFloat(normalizado);
  return isNaN(n) ? null : n;
}

function aTexto(valor) {
  return valor === null || valor === undefined ? '' : String(valor).trim();
}

/**
 * Parte una celda con valores separados por coma. Se usa para los rubros, que
 * se cargan a mano y llegan con espacios y comas de mas.
 */
function aLista(valor) {
  return aTexto(valor)
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
}

/** Convierte una fila de la planilla en un objeto producto. */
function filaAProducto(fila) {
  const o = {};
  COLUMNAS.forEach(function (col, i) { o[col] = fila[i]; });
  return {
    id: aTexto(o.id),
    sku: aTexto(o.sku),
    nombre: aTexto(o.nombre),
    descripcion: aTexto(o.descripcion),
    categoria: aTexto(o.categoria),
    marca: aTexto(o.marca),
    precio: aNumero(o.precio),
    moneda: aTexto(o.moneda) || 'ARS',
    unidades_caja: aNumero(o.unidades_caja),
    presentacion: aTexto(o.presentacion),
    // Por que unidad es el precio y se pide: kg, unidad o caja (vacio = automatico).
    unidad_precio: aTexto(o.unidad_precio).toLowerCase(),
    imagenes: aTexto(o.imagenes) ? aTexto(o.imagenes).split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [],
    destacado: aBool(o.destacado),
    nuevo: aBool(o.nuevo),
    sin_stock: aBool(o.sin_stock),
    orden: aNumero(o.orden) || 0,
    rubros: aLista(o.rubros),
    // Codigo del producto en la planilla de precios externa. Vacio = precio a mano.
    codigo_precio: aTexto(o.codigo_precio),
    // Si la planilla no tiene el dato cargado, se usa la tabla de Pedidos.gs
    pedidos: aNumero(o.pedidos) || pedidosDeTabla(aTexto(o.sku)),
    activo: aBool(o.activo),
    actualizado: o.actualizado instanceof Date ? o.actualizado.toISOString() : aTexto(o.actualizado),
  };
}

/** Convierte un objeto producto en una fila lista para escribir. */
function productoAFila(p) {
  return COLUMNAS.map(function (col) {
    if (col === 'imagenes') return (p.imagenes || []).join(',');
    if (col === 'rubros') return (p.rubros || []).join(', ');
    if (col === 'actualizado') return new Date();
    const v = p[col];
    return v === undefined || v === null ? '' : v;
  });
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/** Devuelve todos los productos de la planilla, en el orden en que estan cargados. */
function leerProductos() {
  const hoja = hojaProductos();
  const ultimaFila = hoja.getLastRow();
  if (ultimaFila < 2) return [];

  const datos = hoja.getRange(2, 1, ultimaFila - 1, COLUMNAS.length).getValues();
  const productos = [];

  datos.forEach(function (fila) {
    if (!aTexto(fila[0]) && !aTexto(fila[2])) return; // fila vacia
    productos.push(filaAProducto(fila));
  });

  // destacados primero, despues por campo orden, despues alfabetico
  productos.sort(function (a, b) {
    if (a.destacado !== b.destacado) return a.destacado ? -1 : 1;
    if (a.pedidos !== b.pedidos) return b.pedidos - a.pedidos;
    if (a.orden !== b.orden) return b.orden - a.orden;
    return a.nombre.localeCompare(b.nombre, 'es');
  });

  return productos;
}

/** Mapa id -> numero de fila en la planilla. */
function mapaDeFilas() {
  const hoja = hojaProductos();
  const ultimaFila = hoja.getLastRow();
  const mapa = {};
  if (ultimaFila < 2) return mapa;
  const ids = hoja.getRange(2, 1, ultimaFila - 1, 1).getValues();
  ids.forEach(function (fila, i) {
    const id = aTexto(fila[0]);
    if (id) mapa[id] = i + 2;
  });
  return mapa;
}

function leerConfig() {
  const hoja = hojaConfig();
  const ultimaFila = hoja.getLastRow();
  const config = {};
  Object.keys(CONFIG_DEFAULTS).forEach(function (k) { config[k] = CONFIG_DEFAULTS[k]; });

  if (ultimaFila >= 2) {
    hoja.getRange(2, 1, ultimaFila - 1, 2).getValues().forEach(function (fila) {
      const clave = aTexto(fila[0]);
      if (clave) config[clave] = aTexto(fila[1]);
    });
  }
  return config;
}

// ---------------------------------------------------------------------------
// API del panel de administracion
// ---------------------------------------------------------------------------

function listarProductosAdmin(token) {
  exigirSesion(token);
  // Una sola lectura de la planilla: categorias y marcas salen de la misma lista.
  const productos = leerProductos();
  return {
    productos: productos,
    config: leerConfig(),
    categorias: valoresUnicos(productos, 'categoria'),
    marcas: valoresUnicos(productos, 'marca'),
  };
}

function valoresUnicos(productos, campo) {
  const vistos = {};
  productos.forEach(function (p) {
    if (p[campo]) vistos[p[campo]] = true;
  });
  return Object.keys(vistos).sort(function (a, b) { return a.localeCompare(b, 'es'); });
}

/**
 * Crea o actualiza un producto. Si viene sin id, se genera uno nuevo.
 * Devuelve el producto guardado.
 */
function guardarProducto(token, datos) {
  exigirSesion(token);

  const nombre = aTexto(datos.nombre);
  if (!nombre) throw new Error('El producto necesita un nombre.');

  const producto = {
    id: aTexto(datos.id) || 'p_' + Utilities.getUuid().slice(0, 12),
    sku: aTexto(datos.sku),
    nombre: nombre,
    descripcion: aTexto(datos.descripcion),
    categoria: aTexto(datos.categoria),
    marca: aTexto(datos.marca),
    precio: aNumero(datos.precio),
    moneda: aTexto(datos.moneda) || 'ARS',
    unidades_caja: aNumero(datos.unidades_caja),
    presentacion: aTexto(datos.presentacion),
    imagenes: (datos.imagenes || []).map(aTexto).filter(Boolean),
    rubros: (datos.rubros || []).map(aTexto).filter(Boolean),
    codigo_precio: aTexto(datos.codigo_precio),
    destacado: aBool(datos.destacado),
    nuevo: aBool(datos.nuevo),
    sin_stock: aBool(datos.sin_stock),
    orden: aNumero(datos.orden) || 0,
    pedidos: aNumero(datos.pedidos) || 0,
    activo: datos.activo === undefined ? true : aBool(datos.activo),
  };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const hoja = hojaProductos();
    const fila = mapaDeFilas()[producto.id];
    // La unidad del precio se elige en el editor de fichas, no en este panel:
    // si el panel no la manda, se conserva la que ya tenia el producto.
    if (datos.unidad_precio !== undefined) {
      producto.unidad_precio = aTexto(datos.unidad_precio).toLowerCase();
    } else if (fila) {
      producto.unidad_precio = aTexto(hoja.getRange(fila, COLUMNAS.indexOf('unidad_precio') + 1).getValue()).toLowerCase();
    }
    const valores = [productoAFila(producto)];

    if (fila) {
      hoja.getRange(fila, 1, 1, COLUMNAS.length).setValues(valores);
    } else {
      hoja.appendRow(valores[0]);
    }
  } finally {
    lock.releaseLock();
  }

  invalidarCache();
  espejarUnProducto(producto);
  return producto;
}

/** Elimina el producto y manda sus imagenes a la papelera de Drive. */
function eliminarProducto(token, id) {
  exigirSesion(token);
  const idLimpio = aTexto(id);
  if (!idLimpio) throw new Error('Falta el id del producto.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let imagenes = [];
  try {
    const hoja = hojaProductos();
    const fila = mapaDeFilas()[idLimpio];
    if (!fila) throw new Error('No se encontro el producto.');

    const datos = hoja.getRange(fila, 1, 1, COLUMNAS.length).getValues()[0];
    imagenes = filaAProducto(datos).imagenes;
    hoja.deleteRow(fila);
  } finally {
    lock.releaseLock();
  }

  imagenes.forEach(function (fileId) {
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (err) { /* ya no existe */ }
  });

  invalidarCache();
  borrarDelEspejo(id);
  return true;
}

/** Cambia solo el campo activo, sin reescribir el resto de la fila. */
function alternarActivo(token, id, activo) {
  exigirSesion(token);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const hoja = hojaProductos();
    const fila = mapaDeFilas()[aTexto(id)];
    if (!fila) throw new Error('No se encontro el producto.');
    const colActivo = COLUMNAS.indexOf('activo') + 1;
    const colFecha = COLUMNAS.indexOf('actualizado') + 1;
    hoja.getRange(fila, colActivo).setValue(aBool(activo));
    hoja.getRange(fila, colFecha).setValue(new Date());
  } finally {
    lock.releaseLock();
  }
  invalidarCache();
  return true;
}

function guardarConfig(token, config) {
  exigirSesion(token);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const hoja = hojaConfig();
    const ultimaFila = hoja.getLastRow();
    const existentes = {};
    if (ultimaFila >= 2) {
      hoja.getRange(2, 1, ultimaFila - 1, 1).getValues().forEach(function (fila, i) {
        const clave = aTexto(fila[0]);
        if (clave) existentes[clave] = i + 2;
      });
    }
    Object.keys(config).forEach(function (clave) {
      const valor = aTexto(config[clave]);
      if (existentes[clave]) {
        hoja.getRange(existentes[clave], 2).setValue(valor);
      } else {
        hoja.appendRow([clave, valor]);
      }
    });
  } finally {
    lock.releaseLock();
  }
  invalidarCache();
  return leerConfig();
}

// ---------------------------------------------------------------------------
// Importacion masiva desde la lista de precios
// ---------------------------------------------------------------------------

/**
 * Toma texto pegado desde Excel o desde un CSV y crea productos en lote.
 * Espera una fila por producto, con columnas separadas por tabulacion, punto
 * y coma o coma. La primera fila puede ser un encabezado.
 *
 * Columnas reconocidas (en cualquier orden, por nombre de encabezado):
 *   nombre, sku, precio, categoria, marca, unidades_caja, presentacion, descripcion
 * Si no hay encabezado, se asume: nombre, precio, unidades_caja, categoria.
 */
function importarLote(token, texto, tieneEncabezado) {
  exigirSesion(token);

  // Ojo: no se hace trim de la linea entera. Si la primera columna viene vacia,
  // recortar el separador inicial correria todos los valores un lugar.
  const filas = String(texto || '')
    .split(/\r?\n/)
    .filter(function (l) { return l.trim() !== ''; })
    .map(partirFila);

  if (!filas.length) throw new Error('No hay filas para importar.');

  let encabezado = null;
  let cuerpo = filas;

  if (tieneEncabezado) {
    encabezado = filas[0].map(function (c) {
      return c.toLowerCase()
        .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
        .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u')
        .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    });
    cuerpo = filas.slice(1);
  }

  const posicionPorDefecto = ['nombre', 'precio', 'unidades_caja', 'categoria'];
  const filasNuevas = [];
  const errores = [];

  // Primero se arma todo en memoria. Recien despues se escribe de una sola vez:
  // guardar fila por fila haria una lectura completa de la hoja por producto y
  // una importacion de varios cientos de filas no terminaria a tiempo.
  cuerpo.forEach(function (celdas, i) {
    const datos = {};
    celdas.forEach(function (celda, j) {
      const campo = encabezado ? encabezado[j] : posicionPorDefecto[j];
      if (campo) datos[campo] = celda;
    });

    if (!aTexto(datos.nombre)) {
      errores.push('Fila ' + (i + 1) + ': sin nombre, se salteo.');
      return;
    }

    filasNuevas.push(productoAFila({
      id: 'p_' + Utilities.getUuid().slice(0, 12),
      sku: aTexto(datos.sku),
      nombre: aTexto(datos.nombre),
      descripcion: aTexto(datos.descripcion),
      categoria: aTexto(datos.categoria),
      marca: aTexto(datos.marca),
      precio: aNumero(datos.precio),
      moneda: 'ARS',
      unidades_caja: aNumero(datos.unidades_caja),
      presentacion: aTexto(datos.presentacion),
      imagenes: [],
      destacado: false,
      nuevo: false,
      sin_stock: false,
      orden: 0,
      pedidos: aNumero(datos.pedidos),
      activo: true,
    }));
  });

  if (filasNuevas.length) {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const hoja = hojaProductos();
      hoja.getRange(hoja.getLastRow() + 1, 1, filasNuevas.length, COLUMNAS.length)
          .setValues(filasNuevas);
    } finally {
      lock.releaseLock();
    }
  }

  invalidarCache();
  return { creados: filasNuevas.length, errores: errores };
}

/** Parte una linea usando el separador que mas columnas produzca. */
function partirFila(linea) {
  const candidatos = ['\t', ';', ','];
  let mejor = [linea];
  candidatos.forEach(function (sep) {
    const partes = linea.split(sep);
    if (partes.length > mejor.length) mejor = partes;
  });
  return mejor.map(function (c) { return c.trim().replace(/^"|"$/g, ''); });
}
