/* ===========================================================================
   Catalogo publico
   ---------------------------------------------------------------------------
   Pide el catalogo al Web App de Apps Script y lo dibuja. Para que la primera
   pantalla no dependa de la latencia de Google, se aplica "servir lo guardado
   y revalidar": si hay una copia en localStorage se pinta al instante y en
   paralelo se busca la version fresca.
   =========================================================================== */

(function () {
  'use strict';

  var CFG = window.CATALOGO_CONFIG || {};
  var CLAVE_CACHE = 'catalogo_datos_v1';
  var CLAVE_PEDIDO = 'catalogo_pedido_v1';
  var CLAVE_CLIENTE = 'catalogo_cliente_v1';
  var CLAVE_ENVIADO = 'catalogo_enviado_v1';

  // Un pedido ya enviado se descarta solo pasado este tiempo. Antes de eso
  // sigue disponible, para que tocar "Enviar" por error no cueste rehacerlo.
  var HORAS_HASTA_OLVIDAR = 3;
  var MAX_CANTIDAD = 999;
  var LIMITE_URL = 3500;

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
    enviadoEn: null,
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
    return String(texto || '').toLowerCase().normalize('NFD').replace(ACENTOS, '');
  }

  function urlImagen(fileId, ancho) {
    return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w' + ancho;
  }

  function urlImagenAlterna(fileId, ancho) {
    return 'https://lh3.googleusercontent.com/d/' + encodeURIComponent(fileId) + '=w' + ancho;
  }

  function formatearPrecio(valor, moneda) {
    if (valor === null || valor === undefined || valor === '') return '';
    try {
      return new Intl.NumberFormat('es-AR', {
        style: 'currency', currency: moneda || 'ARS',
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
    avisoTimer = setTimeout(function () { caja.hidden = true; }, 2800);
  }

  /** Blanco o negro segun cual contraste mejor sobre el color de marca. */
  function tintaSobre(color) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(color || '').trim());
    if (!m) return '#ffffff';
    var n = parseInt(m[1], 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#101215' : '#ffffff';
  }

  function idSeguro(id) {
    return (window.CSS && CSS.escape) ? CSS.escape(id) : String(id).replace(/["\\]/g, '\\$&');
  }

  // -------------------------------------------------------------------------
  // Carga de datos
  // -------------------------------------------------------------------------

  function leerCache() {
    try {
      var crudo = localStorage.getItem(CLAVE_CACHE);
      if (!crudo) return null;
      var envoltorio = JSON.parse(crudo);
      return { datos: envoltorio.datos };
    } catch (err) {
      return null;
    }
  }

  function guardarCache(datos) {
    try {
      localStorage.setItem(CLAVE_CACHE, JSON.stringify({ guardadoEn: Date.now(), datos: datos }));
    } catch (err) { /* sin espacio o modo privado: funciona igual, sin cache */ }
  }

  function pedirCatalogo() {
    if (!CFG.API || CFG.API.indexOf('PEGAR_ACA') === 0) {
      return Promise.reject(new Error(
        'Falta configurar la URL del catalogo. Edita docs/config.js y pega ahi la URL del Web App.'));
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
    if (cache && cache.datos) aplicar(cache.datos);
    else dibujarEsqueletos();

    pedirCatalogo()
      .then(function (datos) {
        guardarCache(datos);
        aplicar(datos);
        $('estado-error').hidden = true;
      })
      .catch(function (err) {
        if (estado.datos) return;   // ya hay algo en pantalla: no molestar
        $('grilla').innerHTML = '';
        $('estado-error-texto').textContent = err.message;
        $('estado-error').hidden = false;
      });
  }

  function aplicar(datos) {
    estado.datos = datos;
    // El servidor ya manda los productos ordenados por lo mas pedido. Se guarda
    // esa posicion para poder volver a ese orden sin conocer el numero, que a
    // proposito no viaja al navegador.
    (datos.productos || []).forEach(function (p, i) { p.posicion = i; });
    aplicarConfig(datos.config || {});
    llenarCategorias(datos.categorias || []);
    llenarMarcas(datos.marcas || []);
    dibujar();
    dibujarPedido();   // el pedido guardado se resuelve contra el catalogo nuevo
    abrirDesdeUrl();
  }

  // -------------------------------------------------------------------------
  // Marca y textos del negocio
  // -------------------------------------------------------------------------

  function aplicarConfig(config) {
    var nombre = config.negocio_nombre || 'Catalogo';

    document.title = nombre;
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

    var contactos = [];
    if (config.telefono) contactos.push({ etiqueta: config.telefono, url: 'tel:' + config.telefono.replace(/\s/g, '') });
    if (config.email) contactos.push({ etiqueta: config.email, url: 'mailto:' + config.email });
    if (config.instagram) contactos.push({ etiqueta: '@' + config.instagram, url: 'https://instagram.com/' + config.instagram });
    if (config.direccion) contactos.push({ etiqueta: config.direccion, url: '' });

    $('pie-contacto').innerHTML = contactos.map(function (c) {
      return '<li>' + (c.url
        ? '<a href="' + escapar(c.url) + '">' + escapar(c.etiqueta) + '</a>'
        : escapar(c.etiqueta)) + '</li>';
    }).join('');

    if (config.whatsapp) $('cta-whatsapp').href = enlaceWhatsapp(null);
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
    $('chips').innerHTML = '<button class="pista viva" type="button" data-categoria="">Todo</button>' +
      categorias.map(function (c) {
        return '<button class="pista" type="button" data-categoria="' + escapar(c) + '">' + escapar(c) + '</button>';
      }).join('');
  }

  function llenarMarcas(marcas) {
    $('filtro-marca').innerHTML = '<option value="">Todas las marcas</option>' +
      marcas.map(function (m) {
        return '<option value="' + escapar(m) + '">' + escapar(m) + '</option>';
      }).join('');
    $('filtro-marca').hidden = marcas.length < 2;
  }

  $('chips').addEventListener('click', function (evento) {
    var pista = evento.target.closest('.pista');
    if (!pista) return;
    Array.prototype.forEach.call($('chips').querySelectorAll('.pista'), function (p) {
      p.classList.toggle('viva', p === pista);
    });
    estado.filtro.categoria = pista.dataset.categoria;
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
    Array.prototype.forEach.call($('chips').querySelectorAll('.pista'), function (p, i) {
      p.classList.toggle('viva', i === 0);
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
    var palabras = normalizar(estado.filtro.texto.trim());
    palabras = palabras ? palabras.split(/\s+/) : [];

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
      // Lo mas pedido arriba. Los destacados van primero igual, y lo que no
      // hay en stock cae al final.
      lista.sort(function (a, b) {
        if (a.sinStock !== b.sinStock) return a.sinStock ? 1 : -1;
        if (a.destacado !== b.destacado) return a.destacado ? -1 : 1;
        if (a.posicion !== b.posicion) return a.posicion - b.posicion;
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
    var hueso = '<div class="hueso"><div class="hueso-losa"></div><div class="hueso-linea"></div></div>';
    var html = '';
    for (var i = 0; i < 12; i++) html += hueso;
    $('grilla').innerHTML = html;
  }

  function mostrarPrecios() {
    var config = (estado.datos && estado.datos.config) || {};
    return String(config.mostrar_precios || 'si').toLowerCase() !== 'no';
  }

  function dibujar() {
    estado.visibles = filtrar();
    $('estado-vacio').hidden = estado.visibles.length > 0;
    $('grilla').innerHTML = estado.visibles.map(pieza).join('');
  }

  /**
   * Una pieza del catalogo. A proposito muestra solo foto, nombre y precio:
   * el resto de los datos vive en la ficha.
   */
  function pieza(p) {
    var senias = '';
    if (p.destacado) senias += '<span class="senia senia-destacado">Destacado</span>';
    if (p.nuevo) senias += '<span class="senia senia-nuevo">Nuevo</span>';
    if (p.sinStock) senias += '<span class="senia senia-sin-stock">Sin stock</span>';

    var foto = p.imagenes && p.imagenes.length
      ? '<img src="' + urlImagen(p.imagenes[0], 480) + '" alt="' + escapar(p.nombre) +
        '" loading="lazy" data-alterna="' + urlImagenAlterna(p.imagenes[0], 480) + '">'
      : '';

    var precio = mostrarPrecios() && p.precio !== null && p.precio !== undefined && p.precio !== ''
      ? escapar(formatearPrecio(p.precio, p.moneda)) : '';

    return '' +
      '<article class="pieza" data-id="' + escapar(p.id) + '">' +
        '<div class="pieza-losa' + (foto ? '' : ' sin-foto') + '">' +
          foto +
          (senias ? '<div class="senias pieza-senias">' + senias + '</div>' : '') +
          (pedidosActivos() ? mando(p) : '') +
        '</div>' +
        '<div class="pieza-pie">' +
          '<button class="pieza-nombre" type="button">' + escapar(p.nombre) + '</button>' +
          '<span class="pieza-precio">' + precio + '</span>' +
        '</div>' +
      '</article>';
  }

  /** Boton "+" o, si el producto ya esta en el pedido, el contador. */
  function mando(p) {
    if (p.sinStock) {
      return '<button class="mas" type="button" disabled aria-label="Sin stock">' + svgMas() + '</button>';
    }
    var cantidad = estado.pedido[p.id] || 0;
    if (!cantidad) {
      return '<button class="mas" type="button" data-accion="sumar" aria-label="Sumar ' +
        escapar(p.nombre) + ' al pedido">' + svgMas() + '</button>';
    }
    return '' +
      '<div class="pieza-paso paso">' +
        '<button class="paso-btn" type="button" data-accion="restar" aria-label="Quitar uno">' + svgMenos() + '</button>' +
        '<input class="paso-valor" type="text" inputmode="numeric" value="' + cantidad +
          '" data-accion="fijar" aria-label="Cantidad de ' + escapar(p.nombre) + '">' +
        '<button class="paso-btn" type="button" data-accion="sumar" aria-label="Sumar uno">' + svgMas() + '</button>' +
      '</div>';
  }

  function svgMas() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  }
  function svgMenos() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>';
  }

  /** Redibuja solo el mando de una pieza, sin rehacer la grilla. */
  function refrescarPieza(id) {
    var el = $('grilla').querySelector('.pieza[data-id="' + idSeguro(id) + '"] .pieza-losa');
    var producto = buscarProducto(id);
    if (!el || !producto || !pedidosActivos()) return;
    var viejo = el.querySelector('.mas, .pieza-paso');
    if (viejo) viejo.remove();
    el.insertAdjacentHTML('beforeend', mando(producto));
  }

  // Fallback de imagen: si el enlace de Drive falla, se prueba el alternativo
  $('grilla').addEventListener('error', function (evento) {
    var img = evento.target;
    if (img.tagName !== 'IMG' || !img.dataset.alterna) return;
    img.src = img.dataset.alterna;
    delete img.dataset.alterna;
  }, true);

  $('grilla').addEventListener('click', function (evento) {
    var piezaEl = evento.target.closest('.pieza');
    if (!piezaEl) return;
    var id = piezaEl.dataset.id;

    var control = evento.target.closest('[data-accion]');
    if (control) {
      if (control.dataset.accion === 'sumar') cambiarCantidad(id, 1);
      if (control.dataset.accion === 'restar') cambiarCantidad(id, -1);
      return;
    }
    if (evento.target.closest('.mas')) return;   // deshabilitado por sin stock
    abrirFicha(id);
  });

  $('grilla').addEventListener('change', function (evento) {
    var campo = evento.target.closest('[data-accion="fijar"]');
    if (!campo) return;
    var piezaEl = campo.closest('.pieza');
    if (piezaEl) fijarCantidad(piezaEl.dataset.id, campo.value);
  });

  // -------------------------------------------------------------------------
  // Movimiento: aparicion e inclinacion
  // -------------------------------------------------------------------------

  var quietud = window.matchMedia('(prefers-reduced-motion: reduce)');
  var punteroFino = window.matchMedia('(hover: hover) and (pointer: fine)');

  /** Inclina la losa hacia el puntero. Solo con mouse y sin quietud pedida. */
  $('grilla').addEventListener('pointermove', function (evento) {
    if (quietud.matches || !punteroFino.matches) return;
    var losa = evento.target.closest('.pieza-losa');
    if (!losa) return;
    var caja = losa.getBoundingClientRect();
    var x = (evento.clientX - caja.left) / caja.width - 0.5;
    var y = (evento.clientY - caja.top) / caja.height - 0.5;
    losa.style.transform =
      'rotateY(' + (x * 7).toFixed(2) + 'deg) rotateX(' + (-y * 7).toFixed(2) + 'deg) translateZ(10px)';
  });

  $('grilla').addEventListener('pointerout', function (evento) {
    var losa = evento.target.closest('.pieza-losa');
    if (losa && !losa.contains(evento.relatedTarget)) losa.style.transform = '';
  });

  var scrollTimer = null;
  window.addEventListener('scroll', function () {
    if (scrollTimer) return;
    scrollTimer = setTimeout(function () {
      document.body.classList.toggle('scrolleado', window.scrollY > 8);
      scrollTimer = null;
    }, 120);
  }, { passive: true });

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

    var senias = '';
    if (p.destacado) senias += '<span class="senia senia-destacado">Destacado</span>';
    if (p.nuevo) senias += '<span class="senia senia-nuevo">Nuevo</span>';
    if (p.sinStock) senias += '<span class="senia senia-sin-stock">Sin stock</span>';
    $('ficha-etiquetas').innerHTML = senias;

    $('ficha-nombre').textContent = p.nombre;
    $('ficha-descripcion').textContent = p.descripcion || '';

    var sub = [];
    if (p.categoria) sub.push(p.categoria);
    if (p.marca) sub.push(p.marca);
    $('ficha-sub').textContent = sub.join(' / ');

    var precio = '';
    if (mostrarPrecios() && p.precio !== null && p.precio !== undefined && p.precio !== '') {
      precio = escapar(formatearPrecio(p.precio, p.moneda));
      if (p.unidadesCaja > 1) {
        precio += '<small>' + escapar(formatearPrecio(p.precio / p.unidadesCaja, p.moneda)) +
          ' por unidad, caja de ' + p.unidadesCaja + '</small>';
      }
    }
    $('ficha-precio').innerHTML = precio;

    var specs = [];
    if (p.presentacion) specs.push(['Presentacion', p.presentacion]);
    if (p.unidadesCaja) specs.push(['Por caja', String(p.unidadesCaja)]);
    if (p.sku) specs.push(['Codigo', p.sku]);
    $('ficha-specs').innerHTML = specs.map(function (par) {
      return '<dt>' + escapar(par[0]) + '</dt><dd>' + escapar(par[1]) + '</dd>';
    }).join('');

    dibujarGaleria(p);

    var wa = $('ficha-whatsapp');
    var enlace = enlaceWhatsapp(p);
    wa.hidden = !enlace || pedidosActivos();
    if (enlace) wa.href = enlace;

    sincronizarFicha(p.id);

    $('ficha-velo').hidden = false;
    ficha.hidden = false;
    document.body.style.overflow = 'hidden';
    $('ficha-cerrar').focus();
    if (location.hash !== '#p=' + p.id) history.replaceState(null, '', '#p=' + p.id);
  }

  /**
   * Pone el bloque de sumar en linea con el pedido. Si el producto todavia no
   * esta, el contador arranca en 1 y sirve para elegir cuanto sumar. Si ya
   * esta, refleja y edita la cantidad real.
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
    $('ficha-agregar').textContent = enPedido ? 'Ver el pedido' : 'Sumar al pedido';
    $('ficha-agregar').dataset.modo = enPedido ? 'ver' : 'sumar';
  }

  $('ficha-sumar').addEventListener('click', function (evento) {
    var boton = evento.target.closest('[data-delta]');
    if (!boton || !estado.fichaActual) return;
    var p = estado.fichaActual;
    var delta = Number(boton.dataset.delta);

    if (estado.pedido[p.id]) {
      cambiarCantidad(p.id, delta);        // ya esta en el pedido: se edita en vivo
    } else {
      var campo = $('ficha-cantidad');
      campo.value = Math.min(Math.max((parseInt(campo.value, 10) || 1) + delta, 1), MAX_CANTIDAD);
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
    if (this.dataset.modo === 'ver') { cerrarFicha(); abrirPedido(); return; }
    fijarCantidad(p.id, parseInt($('ficha-cantidad').value, 10) || 1);
  });

  function dibujarGaleria(p) {
    var imagenes = p.imagenes || [];
    var img = $('ficha-img');
    var marco = $('ficha-marco');

    if (!imagenes.length) {
      img.removeAttribute('src');
      img.alt = '';
      img.hidden = true;
      marco.classList.add('sin-foto');
      $('ficha-tiras').innerHTML = '';
      return;
    }

    img.hidden = false;
    marco.classList.remove('sin-foto');
    mostrarFoto(imagenes[0], p.nombre);

    $('ficha-tiras').innerHTML = imagenes.length > 1
      ? imagenes.map(function (id, i) {
          return '<button class="ficha-tira' + (i === 0 ? ' viva' : '') + '" type="button" data-foto="' +
            escapar(id) + '"><img src="' + urlImagen(id, 140) + '" alt=""></button>';
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
    if (!this.dataset.alterna) return;
    this.src = this.dataset.alterna;
    delete this.dataset.alterna;
  });

  $('ficha-tiras').addEventListener('click', function (evento) {
    var tira = evento.target.closest('.ficha-tira');
    if (!tira) return;
    Array.prototype.forEach.call($('ficha-tiras').querySelectorAll('.ficha-tira'), function (t) {
      t.classList.toggle('viva', t === tira);
    });
    mostrarFoto(tira.dataset.foto, estado.fichaActual ? estado.fichaActual.nombre : '');
  });

  function cerrarFicha() {
    ficha.hidden = true;
    $('ficha-velo').hidden = true;
    estado.fichaActual = null;
    if ($('pedido').hidden) document.body.style.overflow = '';
    if (location.hash.indexOf('#p=') === 0) history.replaceState(null, '', location.pathname);
  }

  $('ficha-cerrar').addEventListener('click', cerrarFicha);
  $('ficha-velo').addEventListener('click', cerrarFicha);

  $('ficha-compartir').addEventListener('click', function () {
    if (!estado.fichaActual) return;
    var url = urlProducto(estado.fichaActual);
    if (navigator.share) {
      navigator.share({ title: estado.fichaActual.nombre, url: url }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url)
        .then(function () { avisar('Link copiado'); })
        .catch(function () { avisar('No se pudo copiar el link'); });
    } else {
      avisar(url);
    }
  });

  function abrirDesdeUrl() {
    var m = /^#p=(.+)$/.exec(location.hash);
    if (m) abrirFicha(decodeURIComponent(m[1]));
  }

  window.addEventListener('hashchange', function () {
    if (location.hash.indexOf('#p=') === 0) abrirDesdeUrl();
    else if (!ficha.hidden) cerrarFicha();
  });

  // Escape cierra lo que este abierto, primero el pedido y despues la ficha
  document.addEventListener('keydown', function (evento) {
    if (evento.key !== 'Escape') return;
    if (!$('pedido').hidden) cerrarPedido();
    else if (!ficha.hidden) cerrarFicha();
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

  /**
   * Como se cuenta este producto: "3 cajas", "3 kg", "3 unidades".
   * La mayoria del catalogo se vende por peso y viene con la presentacion
   * escrita como "Por kg", asi que de ahi se saca la unidad. Un producto con
   * presentacion "10kg" en cambio es un envase: se cuenta por unidad.
   */
  function unidadDe(p, cantidad) {
    if (p.unidadesCaja > 1) return cantidad === 1 ? 'caja' : 'cajas';
    var porAlgo = /^por\s+(.+)$/i.exec(String(p.presentacion || '').trim());
    if (porAlgo) return porAlgo[1].toLowerCase();
    return cantidad === 1 ? 'unidad' : 'unidades';
  }

  function leerPedido() {
    try {
      var guardado = JSON.parse(localStorage.getItem(CLAVE_PEDIDO) || '{}');
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
    } catch (err) { /* sin almacenamiento: vale para esta visita nomas */ }
  }

  /** Marca o desmarca el pedido como ya enviado. */
  function marcarEnviado(cuando) {
    estado.enviadoEn = cuando;
    try {
      if (cuando) localStorage.setItem(CLAVE_ENVIADO, String(cuando));
      else localStorage.removeItem(CLAVE_ENVIADO);
    } catch (err) { /* nada que hacer */ }
  }

  /**
   * Al abrir la pagina: si el ultimo pedido ya se envio hace rato, se descarta
   * para que nadie arranque con el carrito de ayer. Si se envio recien, se
   * conserva; asi tocar "Enviar" por error no obliga a rehacerlo.
   */
  function recuperarPedido() {
    estado.pedido = leerPedido();
    var enviado = null;
    try { enviado = parseInt(localStorage.getItem(CLAVE_ENVIADO) || '', 10); } catch (err) { /* */ }

    if (!enviado || isNaN(enviado)) { estado.enviadoEn = null; return; }

    if (Date.now() - enviado > HORAS_HASTA_OLVIDAR * 3600 * 1000) {
      estado.pedido = {};
      guardarPedido();
      marcarEnviado(null);
    } else {
      estado.enviadoEn = enviado;
    }
  }

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

    // Tocar el pedido lo vuelve a poner en curso
    if (estado.enviadoEn) { marcarEnviado(null); mostrarVista('lista'); }

    guardarPedido();
    refrescarPieza(id);
    sincronizarFicha(id);
    dibujarPedido();

    if (!era && n) avisar(producto.nombre);
  }

  function quitarDelPedido(id) {
    delete estado.pedido[id];
    guardarPedido();
    refrescarPieza(id);
    sincronizarFicha(id);
    dibujarPedido();
  }

  function vaciarPedido() {
    var ids = Object.keys(estado.pedido);
    estado.pedido = {};
    marcarEnviado(null);
    guardarPedido();
    ids.forEach(refrescarPieza);
    mostrarVista('lista');
    dibujarPedido();
  }

  /**
   * Resuelve el pedido contra el catalogo actual. Un producto dado de baja o
   * sin stock desaparece del pedido en lugar de romperlo.
   */
  function lineasDelPedido() {
    var lineas = [];
    var huerfanos = [];

    Object.keys(estado.pedido).forEach(function (id) {
      var producto = buscarProducto(id);
      if (!producto || producto.sinStock) { huerfanos.push(id); return; }
      var tienePrecio = producto.precio !== null && producto.precio !== undefined && producto.precio !== '';
      lineas.push({
        producto: producto,
        cantidad: estado.pedido[id],
        subtotal: tienePrecio ? producto.precio * estado.pedido[id] : null,
      });
    });

    if (huerfanos.length) {
      huerfanos.forEach(function (id) { delete estado.pedido[id]; });
      guardarPedido();
      // Se avisa una sola vez: al salir del pedido ya no se vuelven a contar.
      avisar(huerfanos.length === 1
        ? 'Sacamos un producto que ya no esta disponible'
        : 'Sacamos ' + huerfanos.length + ' productos que ya no estan disponibles');
    }

    return lineas;
  }

  function totalPedido(lineas) {
    return lineas.reduce(function (suma, l) { return suma + (l.subtotal || 0); }, 0);
  }

  function cantidadTotal(lineas) {
    return lineas.reduce(function (suma, l) { return suma + l.cantidad; }, 0);
  }

  // ---------- Dibujado ----------

  function dibujarPedido() {
    var lineas = lineasDelPedido();
    var hayLineas = lineas.length > 0;

    $('pedido-vacio').hidden = hayLineas;
    $('pedido-pie').hidden = !hayLineas;

    $('pedido-lineas').innerHTML = lineas.map(function (l) {
      var p = l.producto;
      var foto = p.imagenes && p.imagenes.length
        ? '<img class="pedido-foto" src="' + urlImagen(p.imagenes[0], 120) + '" alt="" loading="lazy">'
        : '<div class="pedido-foto-vacia"></div>';

      var derecha = mostrarPrecios() && l.subtotal !== null
        ? '<span class="pedido-subtotal">' + escapar(formatearPrecio(l.subtotal, p.moneda)) + '</span>'
        : '<button class="enlace enlace-apagado" type="button" data-accion="quitar">Quitar</button>';

      return '' +
        '<li class="pedido-linea" data-id="' + escapar(p.id) + '">' +
          foto +
          '<div>' +
            '<div class="pedido-nombre">' + escapar(p.nombre) + '</div>' +
            '<div class="pedido-fila">' +
              '<div class="paso">' +
                '<button class="paso-btn" type="button" data-accion="restar" aria-label="Quitar uno">' + svgMenos() + '</button>' +
                '<input class="paso-valor" type="text" inputmode="numeric" value="' + l.cantidad +
                  '" data-accion="fijar" aria-label="Cantidad de ' + escapar(p.nombre) + '">' +
                '<button class="paso-btn" type="button" data-accion="sumar" aria-label="Sumar uno">' + svgMas() + '</button>' +
              '</div>' +
              derecha +
            '</div>' +
          '</div>' +
        '</li>';
    }).join('');

    if (hayLineas && mostrarPrecios()) {
      $('pedido-total').innerHTML = '<span>Total estimado</span><span>' +
        escapar(formatearPrecio(totalPedido(lineas), lineas[0].producto.moneda)) + '</span>';
    } else if (hayLineas) {
      $('pedido-total').innerHTML = '<span>' + cantidadTotal(lineas) + ' items</span>';
    } else {
      $('pedido-total').innerHTML = '';
    }

    prepararEnvio(lineas);
    actualizarDock(lineas);
    cerrarConfirmacion();
  }

  function actualizarDock(lineas) {
    var activo = pedidosActivos();
    var hay = lineas.length > 0;
    var config = (estado.datos && estado.datos.config) || {};

    // El dock solo aparece con algo adentro y mientras el panel este cerrado
    $('dock').hidden = !activo || !hay || !$('pedido').hidden;
    $('dock-cuenta').textContent = cantidadTotal(lineas);
    $('dock-total').textContent = mostrarPrecios() && hay
      ? formatearPrecio(totalPedido(lineas), lineas[0].producto.moneda) : '';

    // La consulta suelta solo tiene sentido si no hay pedidos
    $('cta-whatsapp').hidden = !config.whatsapp || activo;
  }

  // ---------- Panel ----------

  function mostrarVista(cual) {
    $('pedido-vista-lista').hidden = cual !== 'lista';
    $('pedido-vista-enviado').hidden = cual !== 'enviado';
  }

  function abrirPedido() {
    dibujarPedido();
    mostrarVista(estado.enviadoEn ? 'enviado' : 'lista');
    $('pedido-velo').hidden = false;
    $('pedido').hidden = false;
    $('dock').hidden = true;
    $('dock').setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    $('pedido-cerrar').focus();
  }

  function cerrarPedido() {
    $('pedido').hidden = true;
    $('pedido-velo').hidden = true;
    $('dock').setAttribute('aria-expanded', 'false');
    if (ficha.hidden) document.body.style.overflow = '';
    cerrarConfirmacion();
    dibujarPedido();   // vuelve a mostrar el dock si sigue habiendo pedido
  }

  $('dock').addEventListener('click', abrirPedido);
  $('pedido-cerrar').addEventListener('click', cerrarPedido);
  $('pedido-velo').addEventListener('click', cerrarPedido);

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

  // ---------- Vaciar, con confirmacion propia (nada de dialogos del navegador) ----------

  function cerrarConfirmacion() {
    $('pedido-vaciar-confirmar').hidden = true;
    $('pedido-vaciar').hidden = false;
    $('pedido-copiar').hidden = false;
  }

  $('pedido-vaciar').addEventListener('click', function () {
    if (!Object.keys(estado.pedido).length) return;
    $('pedido-vaciar').hidden = true;
    $('pedido-copiar').hidden = true;
    $('pedido-vaciar-confirmar').hidden = false;
  });

  $('pedido-vaciar-no').addEventListener('click', cerrarConfirmacion);
  $('pedido-vaciar-si').addEventListener('click', function () {
    vaciarPedido();
    avisar('Pedido vaciado');
  });

  // ---------- Datos del cliente ----------

  ['pedido-nombre', 'pedido-nota'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      try {
        localStorage.setItem(CLAVE_CLIENTE, JSON.stringify({
          nombre: $('pedido-nombre').value, nota: $('pedido-nota').value,
        }));
      } catch (err) { /* sin almacenamiento: se pierde al cerrar */ }
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

  /**
   * Arma el texto del pedido. Detallado incluye cantidades y subtotales;
   * compacto, solo "2x Producto".
   */
  function textoDelPedido(lineas, compacto, tope) {
    var config = (estado.datos && estado.datos.config) || {};
    var conPrecios = mostrarPrecios();
    var partes = ['*Pedido - ' + (config.negocio_nombre || 'Catalogo') + '*', ''];
    var visibles = tope ? lineas.slice(0, tope) : lineas;

    visibles.forEach(function (l, i) {
      var p = l.producto;
      if (compacto) { partes.push(l.cantidad + 'x ' + p.nombre); return; }
      var titulo = (i + 1) + '. ' + p.nombre + (p.sku ? ' (' + p.sku + ')' : '');
      var renglon = '   ' + l.cantidad + ' ' + unidadDe(p, l.cantidad);
      if (p.unidadesCaja > 1) renglon += ' de ' + p.unidadesCaja;
      if (conPrecios && l.subtotal !== null) renglon += ' - ' + formatearPrecio(l.subtotal, p.moneda);
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

  /** Elige la version que entra en un enlace de WhatsApp. */
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

  function prepararEnvio(lineas) {
    var config = (estado.datos && estado.datos.config) || {};
    var boton = $('pedido-enviar');

    if (!config.whatsapp || !lineas.length) {
      boton.href = '#';
      $('pedido-largo').hidden = true;
      return;
    }

    var armado = textoQueEntra(lineas);
    boton.href = 'https://wa.me/' + String(config.whatsapp).replace(/[^0-9]/g, '') +
      '?text=' + encodeURIComponent(armado.texto);
    $('pedido-largo').hidden = !armado.recortado;
  }

  /**
   * Al enviar no se borra nada: el pedido queda marcado como enviado y el
   * panel pasa al estado de confirmacion. Se descarta solo mas tarde, o
   * cuando el cliente elige empezar uno nuevo.
   */
  $('pedido-enviar').addEventListener('click', function () {
    var lineas = lineasDelPedido();
    if (!lineas.length) return;

    marcarEnviado(Date.now());
    $('enviado-detalle').textContent = mostrarPrecios()
      ? lineas.length + ' productos por ' + formatearPrecio(totalPedido(lineas), lineas[0].producto.moneda) + '.'
      : lineas.length + ' productos enviados.';
    mostrarVista('enviado');
  });

  $('enviado-nuevo').addEventListener('click', function () {
    vaciarPedido();
    cerrarPedido();
  });

  $('enviado-volver').addEventListener('click', function () {
    marcarEnviado(null);
    mostrarVista('lista');
    dibujarPedido();
  });

  $('pedido-copiar').addEventListener('click', function () {
    var lineas = lineasDelPedido();
    if (!lineas.length) return;
    var texto = textoDelPedido(lineas, false);   // al copiar no hay limite de largo

    if (navigator.clipboard) {
      navigator.clipboard.writeText(texto)
        .then(function () { avisar('Pedido copiado'); })
        .catch(function () { avisar('No se pudo copiar'); });
    } else {
      avisar('Tu navegador no permite copiar automaticamente');
    }
  });

  // -------------------------------------------------------------------------
  // Arranque
  // -------------------------------------------------------------------------

  recuperarPedido();
  recordarCliente();
  iniciar();
})();
