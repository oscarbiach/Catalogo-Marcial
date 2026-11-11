/**
 * Configuracion del sitio publico.
 * ---------------------------------------------------------------------------
 * Lo unico que hay que editar aca es CATALOGO_API: pegar la URL del Web App
 * de Apps Script, la que termina en /exec.
 *
 * Todo lo demas (nombre del negocio, logo, colores, WhatsApp, precios) se
 * administra desde el panel y viaja dentro del JSON, asi que no hace falta
 * volver a tocar este archivo.
 */
window.CATALOGO_CONFIG = {

  // Ejemplo: 'https://script.google.com/macros/s/AKfy.../exec'
  API: 'https://script.google.com/macros/s/AKfycbzgSbKJJOA_dcsaAILAVCjDZFdNyE4w5IKIiZIDeXW7jRwqsujEw-9p9BRzzv71CjCraA/exec',

  // Enlace al PDF con la lista completa. Con esto cargado, el boton de la
  // portada pasa a decir "Ver lista de precios" y abre el PDF en otra pestania.
  // Vacio: el boton sigue llevando al catalogo. Es un enlace de Drive con
  // acceso "cualquiera con el enlace"; el PDF no debe incluir costos.
  LISTA_PDF: 'https://drive.google.com/file/d/14-p_lETa106qwpU9Laeomd9Cw8iyOF5i/view',

  // --- Supabase (la base nueva) -----------------------------------------
  // Se lee primero de aca; si falla o esta apagada, se lee de Apps Script.
  // Para encenderla: crear el proyecto, correr
  // supabase/01-catalogo.sql y pegar abajo la URL y la clave PUBLICA (anon)
  // del proyecto, y poner `activo: true`. Nunca pegar aca la clave
  // service_role: esa no se puede publicar. Guia: supabase/LEEME.md
  SUPABASE: {
    activo: true,
    URL: 'https://tdyekqddpchjjiuhglhv.supabase.co',
    // Clave PUBLICA (anon): solo puede leer el catalogo y registrar pedidos.
    ANON: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkeWVrcWRkcGNoamppdWhnbGh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzODIyNjgsImV4cCI6MjEwNjk1ODI2OH0.TqKoZXGP4czlbYtRt6SGDy9syheSAPLwG8rhKvNVvOY',
    guardarPedidos: true,
  },

  // Codigos que el cliente puede ingresar al confirmar un pedido. La base los
  // vuelve a validar y calcula el descuento: esta lista solo permite mostrar
  // de inmediato que beneficio aplica cada codigo. Para agregar una campana,
  // hay que darla de alta tambien en supabase/04-codigos-pedido.sql.
  CODIGOS_PEDIDO: [
    { codigo: 'ARC1', tipo: 'referencia', referencia: 'Referido por Angel' },
    { codigo: 'CYBERMARCIAL', tipo: 'descuento', porcentaje: 10, referencia: '10% de descuento' },
  ],
  // Queda en false hasta aplicar 04-codigos-pedido.sql en Supabase. Mientras
  // tanto, el codigo igual viaja guardado dentro de la nota del pedido y en
  // WhatsApp, sin arriesgar que falle el registro de pedidos actual.
  CODIGOS_SERVIDOR_ACTIVOS: false,

  // Seleccion comercial del carrusel. Se muestra antes que el ranking de
  // pedidos web, que todavia no representa todas las ventas del negocio.
  DESTACADOS_CATALOGO: ['p_6159e7ec-e4a', '117'],

  // Verificacion anti-robots de los pedidos (Cloudflare Turnstile).
  // Vacio = apagada: los pedidos se registran directo, con limite por IP.
  // Para activarla: crear el widget en Cloudflare, pegar aca la clave
  // PUBLICA (site key) y cargar la secreta en Supabase. Guia:
  // supabase/LEEME-TURNSTILE.md. La clave secreta nunca va en este archivo.
  TURNSTILE: {
    siteKey: '',
  },

  // Avisos que se muestran en la ficha de ciertos productos. Cada regla mira el
  // nombre (sin acentos ni mayusculas): `contiene` tiene que estar y `excluye`
  // no. Para sumar otro aviso, agregar otra regla a la lista.
  OBSERVACIONES: [
    { contiene: ['panceta'], excluye: ['chips'], texto: 'Ofrecemos servicio de feteo!' },
  ],

  // Servicio de feteado: solo para estos productos (misma regla de nombre que
  // OBSERVACIONES; "fetas" deja afuera la que ya viene feteada). Suma `recargo`
  // al precio por kg y el mensaje de WhatsApp aclara si va feteada o no.
  FETEADO: { contiene: ['panceta'], excluye: ['chips', 'fetas'], recargo: 0.15 },

  // El catalogo guardado se muestra al instante y se refresca en cada visita.
  // Si pasan estos minutos sin poder refrescarlo, el sitio avisa que los
  // precios en pantalla son los guardados. Tambien se revalida al volver a la
  // pestania despues de este tiempo.
  MINUTOS_CACHE: 30,

};
