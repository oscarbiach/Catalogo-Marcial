/* ===========================================================================
   Catalogo publico
   ---------------------------------------------------------------------------
   Pide el catalogo al Web App de Apps Script y lo dibuja. Para que la primera
   pantalla no dependa de la latencia de Google, se aplica una estrategia
   "servir lo guardado y revalidar": si hay una copia en localStorage se pinta
   al instante y en paralelo se busca la version fresca.
   =========================================================================== */

(function () {
  'use strict';

  var CFG = window.CATALOGO_CONFIG || {};
  var CLAVE_CACHE = 'catalogo_datos_v1';
  var CLAVE_PEDIDO = 'catalogo_pedido_v1';
  var CLAVE_CLIENTE = 'catalogo_cliente_v1';

  var estado = {
    datos: null,
    filtro: { texto: '', categoria: '', marca: '' },
    orden: 'destacados',
    visibles: [],
    fichaActual: null,
    // El pedido guarda solo { idProducto: cantidad }. Nombre y precio se
    // resuelven contra el catalogo en cada dibujado, asi nunca se muestra un
    // precio viejo ni un producto que ya se dio de baja.
    pedido: {},
  };

  var $ = function (id) { return document.getElementById(id); };

  // -------------------------------------------------------------------------
  // Utilidades
  // -------------------------------------------------------------------------

  function escapar(texto) {
    return String(texto === null || texto === undefined ? '' : texto)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Rango de marcas diacriticas de Unicode (U+0300 a U+036F). Se arma con
  // fromCharCode para que el archivo no contenga caracteres invisibles.
  var ACENTOS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');

  /** Quita acentos y pasa a minusculas, para que la busqueda sea tolerante. */
  function normalizar(texto) {
    return String(texto || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(ACENTOS, '');
  }

  /** URL de la imagen alojada en Drive, al ancho pedido. */
  function urlImagen(fileId, ancho) {
    return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w' + ancho;
  }

  /** Enlace alternativo, por si el primero falla. */
  function urlImagenAlterna(fileId, ancho) {
    return 'https://lh3.googleusercontent.com/d/' + encodeURIComponent(fileId) + '=w' + ancho;
  }

  function formatearPrecio(valor, moneda) {
    if (valor === null || valor === undefined || valor === '') return '';
    try {
      return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: moneda || 'ARS',
        minimumFractionDigits: valor % 1 === 0 ? 0 : 2,
        maximumFractionDigits: 2,
      }).format(valor);
    } catch (err) {
      return '$ ' + valor;
    }
  }

  var avisoTimer = null;
  function avisar(texto) {
    var caja = $('aviso');
    caja.textContent = texto;
    caja.hidden = false;
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(function () { caja.hidden = true; }, 2600);
  }

  /** Blanco o negro segun cual contraste mejor sobre el color de marca. */
  function tintaSobre(color) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(color || '').trim());
    if (!m) return '#ffffff';
    var n = parseInt(m[1], 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.62 ? '#14161a' : '#ffffff';
  }

  // -------------------------------------------------------------------------
  // Carga de datos
  // -------------------------------------------------------------------------

  function leerCache() {
    try {
      var crudo = localStorage.getItem(CLAVE_CACHE);
      if (!crudo) return null;
      var envoltorio = JSON.parse(crudo);
      var minutos = (Date.now() - envoltorio.guardadoEn) / 60000;
      return { datos: envoltorio.datos, vencido: minutos > (CFG.MINUTOS_CACHE || 30) };
    } catch (err) {
      return null;
    }
  }

  function guardarCache(datos) {
    try {
      localStorage.setItem(CLAVE_CACHE, JSON.stringify({ guardadoEn: Date.now(), datos: datos }));
    } catch (err) {
      // sin espacio o modo privado: el sitio funciona igual, solo sin cache
    }
  }

  function pedirCatalogo() {
    if (!CFG.API || CFG.API.indexOf('PEGAR_ACA') === 0) {
      return Promise.reject(new Error(
        'Falta configurar la URL del catalogo. Edita docs/config.js y pega ahi la URL del Web App de Apps Script.'));
    }
    var url = CFG.API + (CFG.API.indexOf('?') > -1 ? '&' : '?') + 'action=catalog&t=' + Date.now();
    return fetch(url, { method: 'GET', redirect: 'follow' })
      .then(function (respuesta) {
        if (!respuesta.ok) throw new Error('El servidor respondio ' + respuesta.status + '.');
        return respuesta.json();
      })
      .then(function (datos) {
        if (!datos || !datos.ok) throw new Error('La respuesta del catalogo no tiene el formato esperado.');
        return datos;
      });
  }

  function iniciar() {
    var cache = leerCache();

    if (cache && cache.datos) {
      aplicar(cache.datos);          // pintar al instante lo ultimo conocido
    } else {
      dibujarEsqueletos();
    }

    pedirCatalogo()
      .then(function (datos) {
        guardarCache(datos);
        aplicar(datos);
        $('estado-error').hidden = true;
      })
      .catch(function (err) {
        if (estado.datos) return;    // ya hay algo en pantalla: no molestar
        $('grilla').innerHTML = '';
        $('estado-error-texto').textContent = err.message;
        $('estado-error').hidden = false;
        $('portada-bajada').textContent = '';
      });
  }

  function aplicar(datos) {
    estado.datos = datos;
    aplicarConfig(datos.config || {});
    llenarCategorias(datos.categorias || []);
    llenarMarcas(datos.marcas || []);
    dibujar();
    dibujarPedido();   // el pedido guardado se resuelve contra el catalogo recien cargado
    abrirDesdeUrl();
  }

  // -------------------------------------------------------------------------
  // Marca y textos del negocio
  // -------------------------------------------------------------------------

  function aplicarConfig(config) {
    var nombre = config.negocio_nombre || 'Catalogo';

    document.title = nombre + ' - Catalogo de productos';
    $('logo-texto').textContent = nombre;
    $('pie-nombre').textContent = nombre;
    $('portada-titulo').textContent = nombre;
    $('portada-bajada').textContent = config.negocio_bajada || '';
    $('pie-nota').textContent = config.nota_precios || '';

    if (config.negocio_logo_url) {
      var logo = $('logo-img');
      logo.src = config.negocio_logo_url;
      logo.alt = nombre;
      logo.hidden = false;
      logo.onerror = function () { logo.hidden = true; };
    }

    if (/^#[0-9a-f]{6}$/i.test(config.color_marca || '')) {
      document.documentElement.style.setProperty('--marca', config.color_marca);
      document.documentElement.style.setProperty('--marca-tinta', tintaSobre(config.color_marca));
    }

    var total = (estado.datos.productos || []).length;
    if (total) {
      $('portada-eyebrow').textContent = total + ' productos disponibles';
      $('portada-eyebrow').hidden = false;
    }

    // Contacto en portada y pie
    var contactos = [];
    if (config.telefono) contactos.push({ etiqueta: config.telefono, url: 'tel:' + config.telefono.replace(/\s/g, '') });
    if (config.email) contactos.push({ etiqueta: config.email, url: 'mailto:' + config.email });
    if (config.instagram) contactos.push({ etiqueta: '@' + config.instagram, url: 'https://instagram.com/' + config.instagram });
    if (config.direccion) contactos.push({ etiqueta: config.direccion, url: '' });

    $('portada-datos').innerHTML = contactos.map(function (c) {
      return c.url
        ? '<a href="' + escapar(c.url) + '">' + escapar(c.etiqueta) + '</a>'
        : '<span>' + escapar(c.etiqueta) + '</span>';
    }).join('');

    $('pie-contacto').innerHTML = contactos.map(function (c) {
      return '<li>' + (c.url
        ? '<a href="' + escapar(c.url) + '">' + escapar(c.etiqueta) + '</a>'
        : escapar(c.etiqueta)) + '</li>';
    }).join('');

    // Consulta suelta por WhatsApp. Cuando los pedidos estan activos, el lugar
    // de la cabecera lo ocupa el boton del pedido (ver actualizarIndicadores).
    var cta = $('cta-whatsapp');
    if (config.whatsapp) cta.href = enlaceWhatsapp(null);
  }

  function enlaceWhatsapp(producto) {
    var config = (estado.datos && estado.datos.config) || {};
    if (!config.whatsapp) return '';
    var numero = String(config.whatsapp).replace(/[^0-9]/g, '');
    var texto = config.whatsapp_mensaje || 'Hola! Quiero consultar por el catalogo.';
    if (producto) {
      texto += ' ' + producto.nombre;
      if (producto.sku) texto += ' (SKU ' + producto.sku + ')';
      texto += ' - ' + urlProducto(producto);
    }
    return 'https://wa.me/' + numero + '?text=' + encodeURIComponent(texto);
  }

  function urlProducto(producto) {
    return location.origin + location.pathname + '#p=' + encodeURIComponent(producto.id);
  }

  // -------------------------------------------------------------------------
  // Filtros
  // -------------------------------------------------------------------------

  function llenarCategorias(categorias) {
    var html = '<button class="chip activo" data-categoria="">Todo</button>';
    html += categorias.map(function (c) {
      return '<button class="chip" data-categoria="' + escapar(c) + '">' + escapar(c) + '</button>';
    }).join('');
    $('chips').innerHTML = html;
  }

  function llenarMarcas(marcas) {
    $('filtro-marca').innerHTML = '<option value="">Todas las marcas</option>' +
      marcas.map(function (m) {
        return '<option value="' + escapar(m) + '">' + escapar(m) + '</option>';
      }).join('');
    // Con una sola marca (o ninguna) el filtro no aporta nada.
    $('filtro-marca').hidden = marcas.length < 2;
  }

  $('chips').addEventListener('click', function (evento) {
    var chip = evento.target.closest('.chip');
    if (!chip) return;
    Array.prototype.forEach.call($('chips').querySelectorAll('.chip'), function (c) {
      c.classList.toggle('activo', c === chip);
    });
    estado.filtro.categoria = chip.dataset.categoria;
    dibujar();
  });

  var debounce = null;
  $('buscar').addEventListener('input', function (evento) {
    clearTimeout(debounce);
    var valor = evento.target.value;
    debounce = setTimeout(function () {
      estado.filtro.texto = valor;
      dibujar();
    }, 140);
  });

  $('filtro-marca').addEventListener('change', function (e) {
    estado.filtro.marca = e.target.value;
    dibujar();
  });

  $('orden').addEventListener('change', function (e) {
    estado.orden = e.target.value;
    dibujar();
  });

  $('limpiar-filtros').addEventListener('click', function () {
    estado.filtro = { texto: '', categoria: '', marca: '' };
    $('buscar').value = '';
    $('filtro-marca').value = '';
    Array.prototype.forEach.call($('chips').querySelectorAll('.chip'), function (c, i) {
      c.classList.toggle('activo', i === 0);
    });
    dibujar();
  });

  $('reintentar').addEventListener('click', function () {
    $('estado-error').hidden = true;
    dibujarEsqueletos();
    iniciar();
  });

  function filtrar() {
    var productos = (estado.datos && estado.datos.productos) || [];
    var texto = normalizar(estado.filtro.texto.trim());
    var palabras = texto ? texto.split(/\s+/) : [];

    var lista = productos.filter(function (p) {
      if (estado.filtro.categoria && p.categoria !== estado.filtro.categoria) return false;
      if (estado.filtro.marca && p.marca !== estado.filtro.marca) return false;
      if (!palabras.length) return true;
      var heno = normalizar([p.nombre, p.sku, p.marca, p.categoria, p.presentacion, p.descripcion].join(' '));
      return palabras.every(function (palabra) { return heno.indexOf(palabra) > -1; });
    });

    var conPrecio = function (p) {
      return p.precio === null || p.precio === undefined ? Infinity : p.precio;
    };

    if (estado.orden === 'nombre') {
      lista.sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });
    } else if (estado.orden === 'precio-asc') {
      lista.sort(function (a, b) { return conPrecio(a) - conPrecio(b); });
    } else if (estado.orden === 'precio-desc') {
      lista.sort(function (a, b) {
        var x = conPrecio(a) === Infinity ? -Infinity : conPrecio(a);
        var y = conPrecio(b) === Infinity ? -Infinity : conPrecio(b);
        return y - x;
      });
    } else {
      lista.sort(function (a, b) {
        if (a.sinStock !== b.sinStock) return a.sinStock ? 1 : -1;
        if (a.destacado !== b.destacado) return a.destacado ? -1 : 1;
        if ((b.orden || 0) !== (a.orden || 0)) return (b.orden || 0) - (a.orden || 0);
        return a.nombre.localeCompare(b.nombre, 'es');
      });
    }

    return lista;
  }

  // -------------------------------------------------------------------------
  // Grilla
  // -------------------------------------------------------------------------

  function dibujarEsqueletos() {
    var celda = '<div class="esqueleto"><div class="esqueleto-foto"></div>' +
      '<div class="esqueleto-linea"></div><div class="esqueleto-linea corta"></div></div>';
    var html = '';
    for (var i = 0; i < 10; i++) html += celda;
    $('grilla').innerHTML = html;
  }

  function mostrarPrecios() {
    var config = (estado.datos && estado.datos.config) || {};
    return String(config.mostrar_precios || 'si').toLowerCase() !== 'no';
  }

  function dibujar() {
    estado.visibles = filtrar();
    var total = ((estado.datos && estado.datos.productos) || []).length;

    $('conteo').textContent = estado.visibles.length === total
      ? total + ' productos'
      : estado.visibles.length + ' de ' + total + ' productos';

    $('estado-vacio').hidden = estado.visibles.length > 0;

    $('grilla').innerHTML = estado.visibles.map(tarjeta).join('');
  }

  function tarjeta(p) {
    var etiquetas = '';
    if (p.destacado) etiquetas += '<span class="etiqueta destacado">Destacado</span>';
    if (p.nuevo) etiquetas += '<span class="etiqueta nuevo">Nuevo</span>';
    if (p.sinStock) etiquetas += '<span class="etiqueta sin-stock">Sin stock</span>';


    var foto = p.imagenes && p.imagenes.length
      ? '<div class="tarjeta-foto"><img src="' + urlImagen(p.imagenes[0], 400) + '" alt="' +
        escapar(p.nombre) + '" loading="lazy" data-alterna="' + urlImagenAlterna(p.imagenes[0], 400) + '"></div>'
      : '<div class="tarjeta-foto vacia"></div>';

    var presentacion = [];
    if (p.presentacion) presentacion.push(escapar(p.presentacion));
    if (p.unidadesCaja) presentacion.push('caja x' + p.unidadesCaja);

    var precio = '';
    if (mostrarPrecios() && p.precio !== null && p.precio !== undefined && p.precio !== '') {
      precio = '<div class="tarjeta-precio">' + escapar(formatearPrecio(p.precio, p.moneda));
      if (p.unidadesCaja > 1) {
        precio += '<span class="tarjeta-unitario">' +
          escapar(formatearPrecio(p.precio / p.unidadesCaja, p.moneda)) + ' por unidad</span>';
      }
      precio += '</div>';
    }

    return '' +
      '<article class="tarjeta" data-id="' + escapar(p.id) + '">' +
        foto +
        (etiquetas ? '<div class="tarjeta-etiquetas">' + etiquetas + '</div>' : '') +
        '<div class="tarjeta-cuerpo">' +
          (p.categoria ? '<span class="tarjeta-categoria">' + escapar(p.categoria) + '</span>' : '') +
          '<button class="tarjeta-nombre tarjeta-abrir" type="button">' + escapar(p.nombre) + '</button>' +
          (presentacion.length ? '<span class="tarjeta-presentacion">' + presentacion.join(' &middot; ') + '</span>' : '') +
          precio +
        '</div>' +
        (pedidosActivos() ? '<div class="tarjeta-pie">' + controlPedido(p) + '</div>' : '') +
      '</article>';
  }

  /**
   * Boton "Agregar" o, si el producto ya esta en el pedido, el contador.
   * Se usa igual en la grilla y al redibujar una sola tarjeta.
   */
  function controlPedido(p) {
    if (p.sinStock) {
      return '<button class="btn-sumar" type="button" disabled>Sin stock</button>';
    }

    var cantidad = estado.pedido[p.id] || 0;
    if (!cantidad) {
      return '<button class="btn-sumar" type="button" data-accion="sumar">Agregar</button>';
    }

    return '' +
      '<div class="contador">' +
        '<button class="contador-btn" type="button" data-accion="restar" aria-label="Quitar uno">&minus;</button>' +
        '<input class="contador-valor" type="text" inputmode="numeric" value="' + cantidad +
          '" data-accion="fijar" aria-label="Cantidad de ' + escapar(p.nombre) + '">' +
        '<button class="contador-btn" type="button" data-accion="sumar" aria-label="Agregar uno">+</button>' +
      '</div>' +
      '<span class="contador-unidad">' + escapar(unidadDe(p, cantidad)) + '</span>';
  }

  /** Redibuja solo el pie de una tarjeta, sin rehacer la grilla entera. */
  function refrescarTarjeta(id) {
    var tarjetaEl = $('grilla').querySelector('.tarjeta[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    if (!tarjetaEl) return;
    var pie = tarjetaEl.querySelector('.tarjeta-pie');
    var producto = buscarProducto(id);
    if (pie && producto) pie.innerHTML = controlPedido(producto);
  }

  // Las etiquetas van dentro de .tarjeta pero fuera de .tarjeta-foto, asi que se
  // reposicionan sobre la foto por CSS. Aca solo se maneja el fallback de imagen.
  $('grilla').addEventListener('error', function (evento) {
    var img = evento.target;
    if (img.tagName !== 'IMG' || !img.dataset.alterna) return;
    img.src = img.dataset.alterna;
    delete img.dataset.alterna;
  }, true);

  $('grilla').addEventListener('click', function (evento) {
    var tarjetaEl = evento.target.closest('.tarjeta');
    if (!tarjetaEl) return;
    var id = tarjetaEl.dataset.id;

    var control = evento.target.closest('[data-accion]');
    if (control) {
      if (control.dataset.accion === 'sumar') cambiarCantidad(id, 1);
      if (control.dataset.accion === 'restar') cambiarCantidad(id, -1);
      return;
    }

    if (evento.target.closest('.tarjeta-pie')) return; // clic al vacio del pie
    abrirFicha(id);
  });

  // Escribir un numero directo en el contador de una tarjeta
  $('grilla').addEventListener('change', function (evento) {
    var campo = evento.target.closest('[data-accion="fijar"]');
    if (!campo) return;
    var tarjetaEl = campo.closest('.tarjeta');
    if (tarjetaEl) fijarCantidad(tarjetaEl.dataset.id, campo.value);
  });

  // -------------------------------------------------------------------------
  // Ficha de producto
  // -------------------------------------------------------------------------

  var ficha = $('ficha');

  function buscarProducto(id) {
    var productos = (estado.datos && estado.datos.productos) || [];
    for (var i = 0; i < productos.length; i++) {
      if (productos[i].id === id) return productos[i];
    }
    return null;
  }

  function abrirFicha(id) {
    var p = buscarProducto(id);
    if (!p) return;
    estado.fichaActual = p;

    var etiquetas = '';
    if (p.destacado) etiquetas += '<span class="etiqueta destacado">Destacado</span>';
    if (p.nuevo) etiquetas += '<span class="etiqueta nuevo">Nuevo</span>';
    if (p.sinStock) etiquetas += '<span class="etiqueta sin-stock">Sin stock</span>';
    $('ficha-etiquetas').innerHTML = etiquetas;

    $('ficha-categoria').textContent = p.categoria || '';
    $('ficha-nombre').textContent = p.nombre;
    $('ficha-marca').textContent = p.marca || '';
    $('ficha-descripcion').textContent = p.descripcion || '';

    // Precio
    var precio = '';
    if (mostrarPrecios() && p.precio !== null && p.precio !== undefined && p.precio !== '') {
      precio = escapar(formatearPrecio(p.precio, p.moneda));
      if (p.unidadesCaja > 1) {
        precio += '<small>' + escapar(formatearPrecio(p.precio / p.unidadesCaja, p.moneda)) +
          ' por unidad &middot; caja de ' + p.unidadesCaja + '</small>';
      }
    }
    $('ficha-precio').innerHTML = precio;

    // Especificaciones
    var specs = [];
    if (p.presentacion) specs.push(['Presentacion', p.presentacion]);
    if (p.unidadesCaja) specs.push(['Unidades por caja', String(p.unidadesCaja)]);
    if (p.marca) specs.push(['Marca', p.marca]);
    if (p.categoria) specs.push(['Categoria', p.categoria]);
    if (p.sku) specs.push(['Codigo', p.sku]);
    $('ficha-specs').innerHTML = specs.map(function (par) {
      return '<dt>' + escapar(par[0]) + '</dt><dd>' + escapar(par[1]) + '</dd>';
    }).join('');

    dibujarGaleria(p);

    var wa = $('ficha-whatsapp');
    var enlace = enlaceWhatsapp(p);
    // Con pedidos activos, la consulta suelta sobra: el boton principal es agregar.
    wa.hidden = !enlace || pedidosActivos();
    if (enlace) wa.href = enlace;

    sincronizarFicha(p.id);

    if (!ficha.open) ficha.showModal();
    document.body.style.overflow = 'hidden';
    if (location.hash !== '#p=' + p.id) history.replaceState(null, '', '#p=' + p.id);
  }

  /**
   * Pone el bloque de "agregar al pedido" de la ficha en linea con el pedido.
   * Si el producto todavia no esta, el contador arranca en 1 y sirve para
   * elegir cuanto agregar. Si ya esta, refleja y edita la cantidad real.
   */
  function sincronizarFicha(id) {
    if (!estado.fichaActual || estado.fichaActual.id !== id) return;
    var p = estado.fichaActual;
    var caja = $('ficha-sumar');
    var sePuede = pedidosActivos() && !p.sinStock;

    caja.hidden = !sePuede;
    if (!sePuede) return;

    var enPedido = estado.pedido[p.id] || 0;
    $('ficha-cantidad').value = enPedido || 1;
    $('ficha-agregar').textContent = enPedido ? 'Ver el pedido' : 'Agregar al pedido';
    $('ficha-agregar').dataset.modo = enPedido ? 'ver' : 'agregar';
  }

  $('ficha-sumar').addEventListener('click', function (evento) {
    var boton = evento.target.closest('[data-delta]');
    if (!boton || !estado.fichaActual) return;
    var p = estado.fichaActual;
    var delta = Number(boton.dataset.delta);

    if (estado.pedido[p.id]) {
      cambiarCantidad(p.id, delta);          // ya esta en el pedido: se edita en vivo
    } else {
      var campo = $('ficha-cantidad');
      var valor = (parseInt(campo.value, 10) || 1) + delta;
      campo.value = Math.min(Math.max(valor, 1), MAX_CANTIDAD);
    }
  });

  $('ficha-cantidad').addEventListener('change', function () {
    var p = estado.fichaActual;
    if (!p) return;
    if (estado.pedido[p.id]) fijarCantidad(p.id, this.value);
    else this.value = Math.min(Math.max(parseInt(this.value, 10) || 1, 1), MAX_CANTIDAD);
  });

  $('ficha-agregar').addEventListener('click', function () {
    var p = estado.fichaActual;
    if (!p) return;
    if (this.dataset.modo === 'ver') {
      cerrarFicha();
      abrirPanelPedido();
      return;
    }
    fijarCantidad(p.id, parseInt($('ficha-cantidad').value, 10) || 1);
  });

  function dibujarGaleria(p) {
    var imagenes = p.imagenes || [];
    var img = $('ficha-img');
    var marco = img.parentElement;

    if (!imagenes.length) {
      img.removeAttribute('src');
      img.alt = '';
      img.hidden = true;
      marco.classList.add('vacia');   // el marco dibuja el cartel "Sin foto"
      $('ficha-tiras').innerHTML = '';
      return;
    }

    img.hidden = false;
    marco.classList.remove('vacia');
    mostrarFoto(imagenes[0], p.nombre);

    $('ficha-tiras').innerHTML = imagenes.length > 1
      ? imagenes.map(function (id, i) {
          return '<button class="ficha-tira' + (i === 0 ? ' activa' : '') + '" type="button" data-foto="' +
            escapar(id) + '"><img src="' + urlImagen(id, 120) + '" alt=""></button>';
        }).join('')
      : '';
  }

  function mostrarFoto(fileId, nombre) {
    var img = $('ficha-img');
    img.alt = nombre || '';
    img.dataset.alterna = urlImagenAlterna(fileId, 1000);
    img.src = urlImagen(fileId, 1000);
  }

  $('ficha-img').addEventListener('error', function () {
    var img = $('ficha-img');
    if (!img.dataset.alterna) return;
    img.src = img.dataset.alterna;
    delete img.dataset.alterna;
  });

  $('ficha-tiras').addEventListener('click', function (evento) {
    var tira = evento.target.closest('.ficha-tira');
    if (!tira) return;
    Array.prototype.forEach.call($('ficha-tiras').querySelectorAll('.ficha-tira'), function (t) {
      t.classList.toggle('activa', t === tira);
    });
    mostrarFoto(tira.dataset.foto, estado.fichaActual ? estado.fichaActual.nombre : '');
  });

  /** Deja la pagina como estaba: sin bloqueo de scroll y sin producto en la URL. */
  function limpiarEstadoFicha() {
    document.body.style.overflow = '';
    estado.fichaActual = null;
    if (location.hash.indexOf('#p=') === 0) history.replaceState(null, '', location.pathname);
  }

  function cerrarFicha() {
    if (ficha.open) ficha.close();
    limpiarEstadoFicha();
  }

  $('ficha-cerrar').addEventListener('click', cerrarFicha);

  // Tres caminos de cierre, a proposito redundantes: el evento close del
  // elemento dialog no se dispara de forma confiable en todos los motores.
  ficha.addEventListener('close', limpiarEstadoFicha);
  ficha.addEventListener('cancel', cerrarFicha);
  document.addEventListener('keydown', function (evento) {
    if (evento.key === 'Escape' && ficha.open) cerrarFicha();
  });

  ficha.addEventListener('click', function (evento) {
    // Clic fuera del contenido (sobre el propio dialog) cierra la ficha
    if (evento.target === ficha) cerrarFicha();
  });

  $('ficha-compartir').addEventListener('click', function () {
    if (!estado.fichaActual) return;
    var url = urlProducto(estado.fichaActual);
    var datos = { title: estado.fichaActual.nombre, url: url };

    if (navigator.share) {
      navigator.share(datos).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url)
        .then(function () { avisar('Link copiado.'); })
        .catch(function () { avisar('No se pudo copiar el link.'); });
    } else {
      avisar(url);
    }
  });

  /** Si la URL trae #p=ID, abre esa ficha (sirve para compartir productos). */
  function abrirDesdeUrl() {
    var m = /^#p=(.+)$/.exec(location.hash);
    if (m) abrirFicha(decodeURIComponent(m[1]));
  }

  window.addEventListener('hashchange', function () {
    if (location.hash.indexOf('#p=') === 0) abrirDesdeUrl();
    else if (ficha.open) cerrarFicha();
  });

  // -------------------------------------------------------------------------
  // Pedido
  // -------------------------------------------------------------------------

  /** El negocio puede apagar los pedidos desde la configuracion de la planilla. */
  function pedidosActivos() {
    var config = (estado.datos && estado.datos.config) || {};
    if (!config.whatsapp) return false;   // sin WhatsApp no hay a donde mandarlo
    return String(config.pedidos_activos || 'si').toLowerCase() !== 'no';
  }

  /** "3 cajas", "1 caja", "5 unidades". */
  function unidadDe(p, cantidad) {
    var esCaja = p.unidadesCaja > 1;
    if (esCaja) return cantidad === 1 ? 'caja' : 'cajas';
    return cantidad === 1 ? 'unidad' : 'unidades';
  }

  function leerPedido() {
    try {
      var crudo = localStorage.getItem(CLAVE_PEDIDO);
      var guardado = crudo ? JSON.parse(crudo) : {};
      var limpio = {};
      Object.keys(guardado).forEach(function (id) {
        var n = parseInt(guardado[id], 10);
        if (n > 0) limpio[id] = n;
      });
      return limpio;
    } catch (err) {
      return {};
    }
  }

  function guardarPedido() {
    try {
      localStorage.setItem(CLAVE_PEDIDO, JSON.stringify(estado.pedido));
    } catch (err) {
      // modo privado o sin espacio: el pedido igual funciona en esta visita
    }
  }

  var MAX_CANTIDAD = 999;

  function cambiarCantidad(id, delta) {
    fijarCantidad(id, (estado.pedido[id] || 0) + delta);
  }

  function fijarCantidad(id, cantidad) {
    var producto = buscarProducto(id);
    if (!producto || producto.sinStock) return;

    var n = parseInt(cantidad, 10);
    if (isNaN(n) || n < 0) n = 0;
    if (n > MAX_CANTIDAD) n = MAX_CANTIDAD;

    var era = estado.pedido[id] || 0;
    if (n === 0) delete estado.pedido[id];
    else estado.pedido[id] = n;

    guardarPedido();
    refrescarTarjeta(id);
    sincronizarFicha(id);
    dibujarPedido();

    if (!era && n) avisar(producto.nombre + ' agregado al pedido.');
  }

  function quitarDelPedido(id) {
    delete estado.pedido[id];
    guardarPedido();
    refrescarTarjeta(id);
    sincronizarFicha(id);
    dibujarPedido();
  }

  function vaciarPedido() {
    var ids = Object.keys(estado.pedido);
    estado.pedido = {};
    guardarPedido();
    ids.forEach(refrescarTarjeta);
    dibujarPedido();
  }

  /**
   * Resuelve el pedido contra el catalogo actual. Un producto que se dio de
   * baja o quedo sin stock desaparece del pedido en lugar de romperlo.
   */
  function lineasDelPedido() {
    var lineas = [];
    var huerfanos = [];

    Object.keys(estado.pedido).forEach(function (id) {
      var producto = buscarProducto(id);
      if (!producto || producto.sinStock) { huerfanos.push(id); return; }
      var cantidad = estado.pedido[id];
      var tienePrecio = producto.precio !== null && producto.precio !== undefined && producto.precio !== '';
      lineas.push({
        producto: producto,
        cantidad: cantidad,
        subtotal: tienePrecio ? producto.precio * cantidad : null,
      });
    });

    if (huerfanos.length) {
      huerfanos.forEach(function (id) { delete estado.pedido[id]; });
      guardarPedido();
      // Se avisa una sola vez: al quedar fuera del pedido, no se vuelven a contar.
      avisar(huerfanos.length === 1
        ? 'Sacamos del pedido un producto que ya no esta disponible.'
        : 'Sacamos del pedido ' + huerfanos.length + ' productos que ya no estan disponibles.');
    }

    return lineas;
  }

  function totalPedido(lineas) {
    return lineas.reduce(function (suma, l) {
      return suma + (l.subtotal || 0);
    }, 0);
  }

  function cantidadTotal(lineas) {
    return lineas.reduce(function (suma, l) { return suma + l.cantidad; }, 0);
  }

  // ---------- Dibujado ----------

  function dibujarPedido() {
    var lineas = lineasDelPedido();
    var config = (estado.datos && estado.datos.config) || {};
    var hayLineas = lineas.length > 0;

    $('pedido-vacio').hidden = hayLineas;
    $('pedido-pie').hidden = !hayLineas;

    $('pedido-lineas').innerHTML = lineas.map(function (l) {
      var p = l.producto;
      var foto = p.imagenes && p.imagenes.length
        ? '<img class="pedido-foto" src="' + urlImagen(p.imagenes[0], 120) + '" alt="" loading="lazy">'
        : '<div class="pedido-foto-vacia"></div>';

      var detalle = [];
      if (p.presentacion) detalle.push(escapar(p.presentacion));
      if (p.unidadesCaja > 1) detalle.push('caja x' + p.unidadesCaja);
      if (mostrarPrecios() && l.subtotal !== null) {
        detalle.push(escapar(formatearPrecio(p.precio, p.moneda)) + ' c/u');
      }

      return '' +
        '<li class="pedido-linea" data-id="' + escapar(p.id) + '">' +
          foto +
          '<div>' +
            '<div class="pedido-nombre">' + escapar(p.nombre) + '</div>' +
            (detalle.length ? '<div class="pedido-detalle">' + detalle.join(' &middot; ') + '</div>' : '') +
            '<div class="pedido-fila">' +
              '<div class="contador">' +
                '<button class="contador-btn" type="button" data-accion="restar" aria-label="Quitar uno">&minus;</button>' +
                '<input class="contador-valor" type="text" inputmode="numeric" value="' + l.cantidad +
                  '" data-accion="fijar" aria-label="Cantidad de ' + escapar(p.nombre) + '">' +
                '<button class="contador-btn" type="button" data-accion="sumar" aria-label="Agregar uno">+</button>' +
              '</div>' +
              (mostrarPrecios() && l.subtotal !== null
                ? '<span class="pedido-subtotal">' + escapar(formatearPrecio(l.subtotal, p.moneda)) + '</span>'
                : '<button class="pedido-quitar" type="button" data-accion="quitar">Quitar</button>') +
            '</div>' +
            (mostrarPrecios() && l.subtotal !== null
              ? '<button class="pedido-quitar" type="button" data-accion="quitar">Quitar</button>' : '') +
          '</div>' +
        '</li>';
    }).join('');

    if (hayLineas && mostrarPrecios()) {
      var moneda = lineas[0].producto.moneda;
      $('pedido-total').innerHTML =
        '<span>Total estimado</span><span>' + escapar(formatearPrecio(totalPedido(lineas), moneda)) + '</span>';
      $('pedido-nota-precios').textContent = config.nota_precios || '';
    } else {
      $('pedido-total').innerHTML = hayLineas
        ? '<span>' + cantidadTotal(lineas) + ' items en el pedido</span>' : '';
      $('pedido-nota-precios').textContent = '';
    }

    prepararEnvio(lineas);   // deja el boton listo, o en "#" si el pedido quedo vacio

    actualizarIndicadores(lineas);
  }

  function actualizarIndicadores(lineas) {
    var activo = pedidosActivos();
    var items = lineas.length;
    var unidades = cantidadTotal(lineas);

    $('abrir-pedido').hidden = !activo;
    $('cta-whatsapp').hidden = !( (estado.datos && estado.datos.config && estado.datos.config.whatsapp) && !activo );

    var chapa = $('pedido-cuenta');
    chapa.hidden = items === 0;
    chapa.textContent = unidades;

    var barra = $('barra-pedido');
    barra.hidden = !activo || items === 0;
    document.body.classList.toggle('con-barra-pedido', !barra.hidden);
    $('barra-pedido-cuenta').textContent = unidades;
    $('barra-pedido-total').textContent = mostrarPrecios() && items
      ? formatearPrecio(totalPedido(lineas), lineas[0].producto.moneda) : '';
  }

  // ---------- Panel ----------

  function abrirPanelPedido() {
    dibujarPedido();
    $('pedido-fondo').hidden = false;
    $('pedido').hidden = false;
    document.body.style.overflow = 'hidden';
    $('pedido-cerrar').focus();
  }

  function cerrarPanelPedido() {
    $('pedido').hidden = true;
    $('pedido-fondo').hidden = true;
    if (!ficha.open) document.body.style.overflow = '';
  }

  $('abrir-pedido').addEventListener('click', abrirPanelPedido);
  $('barra-pedido').addEventListener('click', abrirPanelPedido);
  $('pedido-cerrar').addEventListener('click', cerrarPanelPedido);
  $('pedido-fondo').addEventListener('click', cerrarPanelPedido);
  document.addEventListener('keydown', function (evento) {
    if (evento.key === 'Escape' && !$('pedido').hidden) cerrarPanelPedido();
  });

  $('pedido-lineas').addEventListener('click', function (evento) {
    var control = evento.target.closest('[data-accion]');
    if (!control) return;
    var id = control.closest('.pedido-linea').dataset.id;
    if (control.dataset.accion === 'sumar') cambiarCantidad(id, 1);
    if (control.dataset.accion === 'restar') cambiarCantidad(id, -1);
    if (control.dataset.accion === 'quitar') quitarDelPedido(id);
  });

  $('pedido-lineas').addEventListener('change', function (evento) {
    var campo = evento.target.closest('[data-accion="fijar"]');
    if (!campo) return;
    fijarCantidad(campo.closest('.pedido-linea').dataset.id, campo.value);
  });

  $('pedido-vaciar').addEventListener('click', function () {
    if (!Object.keys(estado.pedido).length) return;
    if (confirm('Vaciar el pedido?')) vaciarPedido();
  });

  // Nombre y aclaraciones se recuerdan para no reescribirlos en cada pedido
  ['pedido-nombre', 'pedido-nota'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      try {
        localStorage.setItem(CLAVE_CLIENTE, JSON.stringify({
          nombre: $('pedido-nombre').value, nota: $('pedido-nota').value,
        }));
      } catch (err) { /* sin almacenamiento: se pierde al cerrar, nada mas */ }
      if (!$('pedido-pie').hidden) prepararEnvio(lineasDelPedido());
    });
  });

  function recordarCliente() {
    try {
      var guardado = JSON.parse(localStorage.getItem(CLAVE_CLIENTE) || '{}');
      $('pedido-nombre').value = guardado.nombre || '';
      $('pedido-nota').value = guardado.nota || '';
    } catch (err) { /* sin datos previos */ }
  }

  // ---------- Mensaje de WhatsApp ----------

  var LIMITE_URL = 3500;

  /**
   * Arma el texto del pedido. En version detallada incluye cantidades y
   * subtotales; en compacta, solo "2x Producto". WhatsApp corta los enlaces
   * demasiado largos, asi que si no entra se cae a la compacta y, si aun asi no
   * entra, se recorta avisando cuantos productos quedaron afuera.
   */
  function textoDelPedido(lineas, compacto, tope) {
    var config = (estado.datos && estado.datos.config) || {};
    var conPrecios = mostrarPrecios();
    var partes = ['*Pedido - ' + (config.negocio_nombre || 'Catalogo') + '*', ''];

    var visibles = tope ? lineas.slice(0, tope) : lineas;

    visibles.forEach(function (l, i) {
      var p = l.producto;
      if (compacto) {
        partes.push(l.cantidad + 'x ' + p.nombre);
        return;
      }
      var titulo = (i + 1) + '. ' + p.nombre + (p.sku ? ' (' + p.sku + ')' : '');
      var renglon = '   ' + l.cantidad + ' ' + unidadDe(p, l.cantidad);
      if (p.unidadesCaja > 1) renglon += ' de ' + p.unidadesCaja;
      if (conPrecios && l.subtotal !== null) {
        renglon += ' - ' + formatearPrecio(l.subtotal, p.moneda);
      }
      partes.push(titulo, renglon);
    });

    if (tope && lineas.length > tope) {
      partes.push('', '...y ' + (lineas.length - tope) + ' productos mas que no entraron en este mensaje.');
    }

    if (conPrecios) {
      // El total es SIEMPRE el del pedido completo, aunque el detalle venga
      // recortado: mandar un total parcial haria cotizar de menos.
      partes.push('', '*Total estimado: ' + formatearPrecio(totalPedido(lineas), lineas[0].producto.moneda) + '*');
      if (tope && lineas.length > tope) {
        partes.push('(el total incluye los ' + lineas.length + ' productos del pedido)');
      }
    }

    var nombre = $('pedido-nombre').value.trim();
    var nota = $('pedido-nota').value.trim();
    if (nombre || nota) partes.push('');
    if (nombre) partes.push('Cliente: ' + nombre);
    if (nota) partes.push('Nota: ' + nota);

    return partes.join('\n');
  }

  /**
   * Elige la version del texto que entra en un enlace de WhatsApp.
   * Devuelve { texto, recortado } para poder avisarle al cliente cuando el
   * detalle no entro entero y conviene mandarlo copiado y pegado.
   */
  function textoQueEntra(lineas) {
    var cabe = function (t) { return encodeURIComponent(t).length <= LIMITE_URL; };

    var detallado = textoDelPedido(lineas, false);
    if (cabe(detallado)) return { texto: detallado, recortado: false };

    var compacto = textoDelPedido(lineas, true);
    if (cabe(compacto)) return { texto: compacto, recortado: false };

    var tope = lineas.length;
    while (tope > 1 && !cabe(textoDelPedido(lineas, true, tope))) tope -= 5;
    return { texto: textoDelPedido(lineas, true, Math.max(tope, 1)), recortado: true };
  }

  /** Actualiza el boton de enviar y avisa si el detalle no entra entero. */
  function prepararEnvio(lineas) {
    var config = (estado.datos && estado.datos.config) || {};
    var boton = $('pedido-enviar');

    if (!config.whatsapp || !lineas.length) {
      boton.href = '#';
      $('pedido-largo').hidden = true;
      return;
    }

    var armado = textoQueEntra(lineas);
    var numero = String(config.whatsapp).replace(/[^0-9]/g, '');
    boton.href = 'https://wa.me/' + numero + '?text=' + encodeURIComponent(armado.texto);
    $('pedido-largo').hidden = !armado.recortado;
  }

  $('pedido-copiar').addEventListener('click', function () {
    var lineas = lineasDelPedido();
    if (!lineas.length) return;
    var texto = textoDelPedido(lineas, false);   // al copiar no hay limite de largo

    if (navigator.clipboard) {
      navigator.clipboard.writeText(texto)
        .then(function () { avisar('Pedido copiado.'); })
        .catch(function () { avisar('No se pudo copiar.'); });
    } else {
      avisar('Tu navegador no permite copiar automaticamente.');
    }
  });

  // -------------------------------------------------------------------------
  // Arranque
  // -------------------------------------------------------------------------

  estado.pedido = leerPedido();
  recordarCliente();
  iniciar();
})();
