# Plan maestro de acción y refactorización — auditoría del catálogo

Base auditada: commit `7b5d42d`. Correcciones en la rama `claude/vibrant-ritchie-cfbnth`.
Cada bloque corregido lleva en el código el comentario `[AUDITORIA Hxx]`; buscando esa
etiqueta se encuentra el cambio y el motivo.

---

## 0. Revisión crítica del informe

Verifiqué cada hallazgo contra el código y reproduje los importantes con pruebas
(Postgres local, Playwright con las fuentes simuladas y una hoja de cálculo simulada para el Apps Script).

| ID | Veredicto | Severidad revisada | Comentario |
|---|---|---|---|
| H01 | **Confirmado** | Alta | `soloPorCaja()` depende de `soloCaja`/`kgCaja`, que solo llegan desde Supabase (listas `caja_cerrada*`). El informe no señala la causa de fondo: **esas listas no existen en la planilla**, así que Apps Script no puede devolverlas aunque se lo modifique. |
| H02 | **Confirmado, con un ajuste** | Alta | `fetch` sin mirar `response.ok` y sin idempotencia: confirmado. Pero la recomendación de mostrar "enviado" *solo con confirmación real del canal* **no se puede cumplir**: `wa.me` no informa si el usuario tocó Enviar. Lo correcto es decir la verdad ("abrimos WhatsApp") y mostrar aparte el estado del registro, que sí se puede saber. |
| H03 | **Confirmado** | Alta | Ya figuraba como riesgo aceptado en `supabase/LEEME.md`. Se mitiga en la base (Fase 1). El arreglo de fondo, un endpoint de servidor con anti-robots, queda para la Fase 3. |
| H04 | **Confirmado y subestimado** | **Crítica** | Lo reproduje: con `{"ok":true,"config":{}}` la función original **despublica el 100 % del catálogo** y lo registra como sincronización exitosa (`ocultados: 4, productos: null`). |
| H05 | Confirmado | Alta | Además, un `telefono` numérico en la configuración rompía `aplicarConfig` (`.replace` sobre un número). Se resuelve con la misma normalización. |
| H06 | Confirmado | Alta | `MINUTOS_CACHE` no se usaba y su comentario en `config.js` estaba fuera de lugar. |
| H07 | Confirmado | Media | |
| H08 | Confirmado | Media | |
| H09 | Confirmado | Media | Solo afecta productos con precio por kg vendidos por caja (en `unidad × unidades_caja` no hay redondeo). |
| H10 | **Latente** | Baja | Los 266 productos están en ARS; hoy no tiene impacto. Se agregó una protección barata en el cliente y en la base. |
| H11 | Confirmado | Media | |
| H12 | Confirmado | Media | |
| H13 | Confirmado | Media | Lo reproduje: la versión original escribe el nombre y después falla por la unidad. |
| H14 | Confirmado | Baja | Es una herramienta interna con pocos editores a la vez. |
| H15 | Confirmado | Baja | |
| H16 | **En parte, sin impacto medible** | Baja | Con unos 270 productos, normalizar en cada búsqueda cuesta menos de 1 ms. No es un cuello de botella; se corrigió porque el arreglo es trivial. Lo del carrusel es válido para la batería. |
| H17 | Confirmado | Baja | |
| H18 | Confirmado; **más frecuente de lo que sugiere el informe** | Media | Pasa en *cada visita con caché* si el usuario toca un filtro antes de que llegue la red. |
| H19 | Válido como deuda | — | Proceso y arquitectura (Fase 3). |

### Hallazgos que el informe no detectó

| ID | Severidad | Descripción | Estado |
|---|---|---|---|
| A1 | Media | `02-sincronizacion.sql` decía ser re-ejecutable, pero `create trigger` sin `drop … if exists` fallaba al correrlo de nuevo. | Corregido |
| A2 | Media | `01-catalogo.sql` definía `registrar_pedido` usando columnas que crea recién `02` (`solo_caja`, `kg_caja`): una instalación limpia fallaba al registrar el primer pedido. Además, volver a correr `01` restauraba la versión sin límites. | Corregido (se movió a `03-pedidos.sql`) |
| A3 | Baja | Una clave de configuración de la planilla que empezara con `_` se interpretaba en el navegador como lista JSON. | Corregido |
| A4 | Baja | Volver a correr `cron.schedule` podía duplicar la tarea en versiones viejas de pg_cron. | Corregido |

---

## 1. Triage y matriz de prioridades

### Fase 1 — Blocker / inmediato (seguridad y bugs que rompen catálogo o pedidos) — **implementada**

| Orden | ID | Archivo | Cambio |
|---|---|---|---|
| 1 | H04 | `supabase/02-sincronizacion.sql` | `aplicar_catalogo(jsonb)` pura y separada de la descarga; validación con `IS DISTINCT FROM`; se valida todo el lote antes de escribir; umbral sobre ids válidos y únicos; un dato inválido rechaza el lote; `_sincronizado_en`; vista `estado_sincronizacion`. |
| 2 | H01 | `docs/assets/js/app.js` | Cada lectura de Supabase guarda las reglas de caja; el respaldo las hereda (7 días). Sin reglas confiables, el respaldo pasa a **modo consulta**: catálogo visible, pedido por WhatsApp y un aviso visible. No se inventa ninguna equivalencia. |
| 3 | H02 | `app.js`, `index.html`, `03-pedidos.sql` | Un UUID por intento lógico (`p_ref`), igual en todos los reintentos y renovado al cambiar el contenido; se incluye en el mensaje de WhatsApp (`Ref: XXXXXXXX`). Se revisa el HTTP y el cuerpo del error. La confirmación dice lo que de verdad pasó y aparte muestra el estado del registro. El servidor devuelve id, líneas y total. |
| 4 | H03 | `supabase/03-pedidos.sql` | Límite por IP (5 cada 10 min y 30 por día), tope global (150 por hora) y HTTP 429. Se elimina la versión sin límites. |
| 5 | H05 | `app.js` | `normalizarCatalogo()` valida y normaliza la red y la caché; la caché pasa a v2 con versión de esquema y se descarta si no valida; se aplica dentro de un `try` y la consulta a la red arranca siempre; solo se guarda lo que se validó y se dibujó. |
| 6 | H07 | `03-pedidos.sql` | Rechaza ids inexistentes, despublicados o sin stock, cantidades inválidas, ids repetidos y `pedidos_activos = no`. O entra el pedido entero o no entra. |
| 7 | H06 | `app.js`, `02`, `config.js` | La versión es la fecha de la última sincronización buena. Hay aviso visible cuando la caché no se pudo refrescar después de `MINUTOS_CACHE` o cuando la sincronización lleva más de 2 h parada. Se revalida en `online` y al volver a la pestaña. |
| 8 | H13 | `apps-script/EditorFichas.gs` | Dos fases: primero se valida todo y se arma la lista de escrituras; recién después se escribe, se anota el historial y se invalida la caché. |

### Fase 2 — Performance y consistencia de datos — **implementada**

| ID | Archivo | Cambio |
|---|---|---|
| H09 | `app.js`, `03` | `precioDeLinea()` redondea la caja a centavos y después multiplica, igual que la base. `redondear2()` reproduce el `round(numeric, 2)` de Postgres. |
| H08 | `app.js` | Tope de 100 productos en el carrito; lo recuperado se recorta a 1–999. |
| H11 | `app.js` | `pedirJson()` con `AbortController` y un plazo de 8 s por fuente, que incluye la lectura del cuerpo. El respaldo entra en ese tiempo como máximo. |
| H12 | `app.js`, `index.html` | `maxlength=300`; el mismo recorte se aplica a WhatsApp y a la base; `textoQueEntra()` usa búsqueda binaria y siempre devuelve un texto que cabe. |
| H16 | `app.js` | El texto de búsqueda se normaliza una sola vez; el carrusel deja de pedir cuadros cuando no está a la vista o la pestaña está oculta. |
| H17 | `app.js` | `bajarFoto()` devuelve la URL que funcionó y reutiliza las descargas en curso. |
| H18 | `app.js` | Las categorías, la marca y el rubro conservan lo que eligió el usuario al refrescar. |
| H15 | `app.js` | El evento `storage` sincroniza el pedido entre pestañas (solo lee, así que no rebota). |
| H14 | `EditorFichas.gs/.html` | Concurrencia optimista: el editor manda `antes` y no se pisa un campo que cambió otra persona. `refiltrar` respeta `ocupado`. |
| H10 | `app.js`, `03` | Si hubiera monedas mezcladas, el total queda "a confirmar"; la base rechaza el pedido y guarda la moneda. |

### Fase 3 — Código limpio, mantenibilidad y cierre de riesgos de fondo — **pendiente (diseño)**

1. **H03 de fondo.** Una Supabase Edge Function `registrar-pedido` con Cloudflare Turnstile. Pasos: (a) la función verifica el token de Turnstile, (b) llama a `registrar_pedido` con un rol de privilegios mínimos, (c) se revoca el `execute` a `anon`. Al cliente solo se le agrega el widget y el token en el POST.
2. **H01 definitivo.** ✅ Hecho: columnas `solo_caja` y `kg_caja` en la planilla (`apps-script/CajaCerrada.gs`, ver `apps-script/LEEME-CAJA.md`). Con `contrato: 2`, Apps Script las publica y Supabase las escribe directo en `productos` (las listas `caja_cerrada*` quedan intactas como respaldo del contrato 1), con una red de seguridad si desaparece más de la mitad. Ensayado en producción con datos reales: 0 diferencias. El modo consulta y las reglas heredadas quedan como protección mientras no se active el contrato 2.
3. **Alertas de sincronización.** ✅ Hecho: `.github/workflows/vigilancia.yml` revisa cada hora `_sincronizado_en` con la clave pública y falla si pasaron más de 60 minutos; GitHub avisa por correo. No requiere claves secretas.
4. **H19, modularización sin bundler.** Partir `app.js` en módulos ES (`<script type="module">`): `contrato.js` (normalización y reglas), `fuentes.js` (Supabase, Apps Script, caché), `pedido.js` (carrito, totales, registro), `ui/*.js`. Las funciones puras de `contrato.js` y `pedido.js` se pueden probar en Node sin DOM. Sumar `// @ts-check` y los `@typedef` que ya están en `app.js` para tener chequeo de tipos de TypeScript sin compilar.
5. **CI.** ✅ Hecho: `.github/workflows/pruebas.yml` corre `pruebas/regresion.js` y `pruebas/sql/correr-local.sh` en cada PR.
6. **PWA.** No hay Service Worker: el sitio no abre sin conexión. Como mínimo, un SW con caché de la estructura del sitio (HTML, CSS, JS y fuentes) y `network-first` para los datos. Va después del punto 4.

---

## 2. Código de producción

Los archivos completos y corregidos están en la rama; se copian tal cual:

| Archivo | Dónde va | Qué contiene |
|---|---|---|
| `supabase/02-sincronizacion.sql` | Supabase › SQL Editor | H04, H06, A1, A4 |
| `supabase/03-pedidos.sql` (nuevo) | Supabase › SQL Editor | H02, H03, H07, H09, H10 |
| `supabase/01-catalogo.sql` | Solo para instalaciones nuevas | A2: ya no crea `registrar_pedido` |
| `docs/assets/js/app.js` | GitHub Pages | H01, H02, H05, H06, H08, H09, H10, H11, H12, H15, H16, H17, H18 |
| `docs/index.html`, `docs/assets/css/styles.css`, `docs/config.js` | GitHub Pages | Aviso de datos, confirmación, `maxlength`, `?v=41` |
| `apps-script/EditorFichas.gs` / `.html` | Apps Script del catálogo | H13, H14 |

### Orden de despliegue (importa)

1. **Supabase, `02-sincronizacion.sql`.** Pegarlo entero y correrlo. Después: `select public.sincronizar_catalogo();` tiene que devolver `{"productos": …}` sin `error`, y `select * from config where clave = '_sincronizado_en';` tiene que mostrar la fecha.
2. **Supabase, `03-pedidos.sql`.** Desde ese momento, el sitio viejo (que todavía llama a la función de 3 argumentos) deja de registrar pedidos **sin afectar al cliente**: ese registro ya iba sin esperar respuesta y WhatsApp se abre igual. Por eso se corre antes del paso 3.
3. **Publicar `docs/`** (merge a la rama de GitHub Pages). `?v=41` fuerza a los navegadores a bajar el JS nuevo.
4. **Apps Script.** Reemplazar `FichasCodigo` (`EditorFichas.gs`) y `EditorFichas` (`EditorFichas.html`).

**Rollback.** Frontend: revertir el commit (o `SUPABASE.activo: false` en `config.js`, que sigue funcionando). SQL: las versiones anteriores de las funciones están en `git show 7b5d42d:supabase/01-catalogo.sql` y en `git show 7b5d42d:supabase/02-sincronizacion.sql`. Ningún script borra datos; `03` solo agrega columnas e índices a `pedidos_catalogo`.

---

## 3. Plan de pruebas de regresión

### 3.1 Automáticas (ya pasan sobre esta rama)

```bash
# Frontend: 13 escenarios con Supabase y Apps Script simulados (no toca producción)
NODE_PATH=$(npm root -g) node pruebas/regresion.js

# Base: aplica 01/02/03 en un Postgres temporal y corre 19 casos
pruebas/sql/correr-local.sh
```

Contra el código original (`7b5d42d`), la suite del frontend falla **12 de 13** casos.
El único que pasa es el camino feliz de Supabase, que ya funcionaba. Las pruebas
detectan los defectos y no son decorativas.

### 3.2 Manuales después del despliegue (producción, con cuidado)

**Base (SQL Editor)**
- [ ] `select * from estado_sincronizacion;` muestra `antiguedad` menor de 15 min y `fallas_seguidas = 0`.
- [ ] `select * from sincronizacion_log order by id desc limit 3;` muestra las últimas corridas con `ok = true`.
- [ ] Hacer un pedido de prueba desde el sitio y después correr `select ref, origen_ip, total_estimado from pedidos_catalogo order by creado_en desc limit 1;`. **`origen_ip` no puede ser `desconocida`**: si lo es, el límite por IP no está actuando, aunque queda el global. En ese caso, revisar con `select current_setting('request.headers', true)` dentro de la función qué cabecera trae la IP.
- [ ] Borrar el pedido de prueba.

**Catálogo (navegador, con DevTools abierto)**
- [ ] Primera visita en una ventana privada: carga sin errores en la consola y sin aviso amarillo.
- [ ] El producto 105 dice "se pide por caja de 20". Sumar 1 y verificar que el pedido muestre $32.480.
- [ ] Buscar un texto, filtrar por categoría y por marca, ordenar por precio: igual que antes.
- [ ] Recargar con caché, tocar una categoría enseguida y esperar 3 s: la categoría sigue marcada y la grilla sigue filtrada (H18).
- [ ] La ficha de un producto por caja por kg muestra el precio de la caja redondeado a centavos.
- [ ] Carrusel "Los más pedidos": avanza, se frena al pasar el mouse y se puede arrastrar. Con "reducir movimiento" activado en el sistema queda quieto.
- [ ] Tema claro/oscuro, cajón de rubros, buscador del celular y botón flotante de WhatsApp: sin cambios.

**Pedido**
- [ ] Armar un pedido con 3 productos y ver que el enlace de WhatsApp incluye `Ref: XXXXXXXX`.
- [ ] Tocar Enviar: aparece "Pedido listo en WhatsApp", la referencia y, en uno o dos segundos, "Pedido registrado.".
- [ ] "Volver a mi pedido", tocar Enviar otra vez y comprobar que en la base sigue habiendo **un** pedido con esa `ref`.
- [ ] Cambiar una cantidad y enviar: se crea una `ref` nueva y un segundo pedido.
- [ ] El total del mensaje de WhatsApp es igual a `total_estimado` de la base.
- [ ] "Copiar", "Vaciar" (con su confirmación) y "Empezar uno nuevo" funcionan.
- [ ] Abrir dos pestañas, sumar en una y ver que el contador de la otra se actualiza.
- [ ] En DevTools › Network › Offline, tocar Enviar: WhatsApp se abre igual y el panel dice "No pudimos registrar el pedido (sin conexión)".

**Respaldo y caché (DevTools)**
- [ ] Bloquear `tdyekqddpchjjiuhglhv.supabase.co` (Network › Block request domain) y recargar: entra Apps Script, el 105 **sigue** pidiéndose por caja de 20 (reglas heredadas) y no hay aviso de respaldo.
- [ ] Lo mismo en una ventana privada nueva (sin reglas guardadas): aviso "catálogo de respaldo", sin botones "+", y el botón de consulta por WhatsApp visible en la ficha.
- [ ] En Application › Local Storage, cambiar `catalogo_datos_v2` por `{"esquema":2,"datos":{"ok":true,"productos":{}}}` y recargar: el catálogo carga igual.
- [ ] Con Network › Offline y una caché de más de 30 min (se puede editar `datos.obtenidoEn` en la caché): aparece el aviso "No pudimos actualizar el catálogo…".

**Editor de fichas (en una copia de la planilla)**
- [ ] Cambiar el nombre y poner una unidad inválida forzada desde la consola: error y **ninguna** celda cambiada (H13).
- [ ] Abrir el editor en dos navegadores, cambiar la descripción en A y guardar; después cambiarla en B y guardar: B recibe "Otra persona cambió…" (H14).
- [ ] Cambiar filtros rápido mientras se guarda: no hay guardados superpuestos.
- [ ] Revisar que `Historial fichas` registre cada cambio.
