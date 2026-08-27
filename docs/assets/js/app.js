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

  var estado = {
    datos: null,
    filtro: { texto: '', categoria: '', marca: '' },
    orden: 'destacados',
    visibles: [],
    fichaActual: null,
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

    // Boton de WhatsApp de la cabecera
    var cta = $('cta-whatsapp');
    if (config.whatsapp) {
      cta.href = enlaceWhatsapp(null);
      cta.textContent = 'Consultar';
      cta.hidden = false;
    } else {
      cta.hidden = true;
    }
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
      '<button class="tarjeta" data-id="' + escapar(p.id) + '" type="button">' +
        foto +
        (etiquetas ? '<div class="tarjeta-etiquetas">' + etiquetas + '</div>' : '') +
        '<div class="tarjeta-cuerpo">' +
          (p.categoria ? '<span class="tarjeta-categoria">' + escapar(p.categoria) + '</span>' : '') +
          '<span class="tarjeta-nombre">' + escapar(p.nombre) + '</span>' +
          (presentacion.length ? '<span class="tarjeta-presentacion">' + presentacion.join(' &middot; ') + '</span>' : '') +
          precio +
        '</div>' +
      '</button>';
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
    var boton = evento.target.closest('.tarjeta');
    if (!boton) return;
    abrirFicha(boton.dataset.id);
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
    wa.hidden = !enlace;
    if (enlace) wa.href = enlace;

    if (!ficha.open) ficha.showModal();
    document.body.style.overflow = 'hidden';
    if (location.hash !== '#p=' + p.id) history.replaceState(null, '', '#p=' + p.id);
  }

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
  iniciar();
})();
