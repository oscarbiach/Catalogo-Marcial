/* ===========================================================================
   Service Worker del catalogo: que el sitio abra sin conexion.
   ---------------------------------------------------------------------------
   Solo guarda la "cascara" del sitio (HTML, CSS, JS, fuente y logos). Los
   datos del catalogo NO pasan por aca: app.js ya guarda su copia validada y
   avisa cuando los precios son los guardados. Supabase, Apps Script y las
   fotos de Drive van directo a la red.

   Estrategias:
   - Pagina (navegacion): primero la red; sin conexion, la copia guardada.
     Con conexion siempre se ve la ultima version publicada.
   - Archivos propios: la copia guardada al instante y, en segundo plano, la
     de la red. Llevan ?v=N, asi que cada version es una URL distinta.

   La lista de archivos sale del propio index.html: no hay que mantenerla a
   mano. Lo que el HTML nuevo ya no usa se borra de la copia.
   =========================================================================== */

'use strict';

var CACHE = 'catalogo-cascara-v1';
var PAGINA = 'index.html';

/** Las rutas locales que usa el HTML (href/src sin dominio), sin el #fragmento. */
function archivosDelHtml(html) {
  var vistos = {};
  var re = /(?:href|src)="([^"#:]+)(?:#[^"]*)?"/g;
  var m;
  while ((m = re.exec(html))) {
    var ruta = m[1].trim();
    if (ruta && ruta.charAt(0) !== '/' && ruta.indexOf('//') === -1) vistos[ruta] = true;
  }
  // Los modulos de JavaScript: los valores del import map ("...": "./assets/...").
  var mapa = /:\s*"(\.\/[^"#]+)"/g;
  while ((m = mapa.exec(html))) vistos[m[1].slice(2)] = true;
  // La fuente la pide tokens.css; el HTML solo la precarga, igual se incluye.
  return Object.keys(vistos);
}

function absoluta(ruta) {
  return new URL(ruta, self.registration.scope).href;
}

/**
 * Guarda la pagina y todo lo que usa, y borra lo que ya no usa. Si algun
 * archivo no baja, no se guarda nada a medias para esa version: se sigue con
 * la copia anterior.
 */
function refrescarCascara(html) {
  var urls = archivosDelHtml(html).map(absoluta);
  return caches.open(CACHE).then(function (cache) {
    return Promise.all(urls.map(function (url) {
      return cache.match(url).then(function (ya) {
        return ya || fetch(url, { cache: 'no-cache' }).then(function (r) {
          if (!r.ok) throw new Error(url + ' respondio ' + r.status);
          return cache.put(url, r);
        });
      });
    })).then(function () {
      return cache.put(absoluta(PAGINA), new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }));
    }).then(function () {
      var validas = {};
      urls.forEach(function (u) { validas[u] = true; });
      validas[absoluta(PAGINA)] = true;
      return cache.keys().then(function (claves) {
        return Promise.all(claves.map(function (req) {
          return validas[req.url] ? null : cache.delete(req);
        }));
      });
    });
  });
}

self.addEventListener('install', function (evento) {
  evento.waitUntil(
    fetch(absoluta(PAGINA), { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('index.html respondio ' + r.status);
        return r.text();
      })
      .then(refrescarCascara)
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (evento) {
  evento.waitUntil(
    caches.keys().then(function (nombres) {
      return Promise.all(nombres.map(function (n) {
        return n !== CACHE && n.indexOf('catalogo-cascara-') === 0 ? caches.delete(n) : null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (evento) {
  var req = evento.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  // Solo lo propio. Datos y fotos van directo a la red, sin pasar por aca.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.slice(-5) === 'sw.js') return;

  if (req.mode === 'navigate') {
    evento.respondWith(
      fetch(req).then(function (r) {
        if (r.ok) {
          var copia = r.clone();
          evento.waitUntil(copia.text().then(refrescarCascara).catch(function () { /* queda la anterior */ }));
        }
        return r;
      }).catch(function () {
        return caches.match(absoluta(PAGINA)).then(function (guardada) {
          return guardada || new Response(
            '<!doctype html><meta charset="utf-8"><title>Sin conexion</title>' +
            '<p style="font-family:sans-serif;padding:24px">Sin conexion. Volve a intentar cuando tengas internet.</p>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        });
      })
    );
    return;
  }

  evento.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(req).then(function (guardada) {
        var deRed = fetch(req).then(function (r) {
          if (r.ok) cache.put(req, r.clone());
          return r;
        });
        if (guardada) {
          evento.waitUntil(deRed.catch(function () { /* sin red: queda la guardada */ }));
          return guardada;
        }
        return deRed;
      });
    })
  );
});
