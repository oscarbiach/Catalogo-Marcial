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

  // --- Base de datos ---------------------------------------------------
  // El catalogo se lee de aca, que es una copia de la planilla. Si algo no
  // anda, poner `activo: false` y el sitio vuelve a leer de Apps Script
  // exactamente como antes: es el unico cambio que hace falta para volver
  // atras. Los pedidos dejan de guardarse, nada mas.
  //
  // La clave de abajo es la PUBLICA: solo puede leer el catalogo. Los pedidos
  // no se pueden ni leer ni escribir con ella.
  INSFORGE: {
    activo: true,
    URL: 'https://4g9n2tis.us-east.insforge.app',
    ANON: 'anon_43e6e1c470b7041b3fb871d2c9b1e3558fbd5243d87bd82a2cf2c977d252aed4',
    // Guardar el pedido cuando el cliente lo manda por WhatsApp. Es lo que
    // hace que el orden por mas pedidos se actualice solo.
    guardarPedidos: true,
  },

  // Minutos que el navegador reutiliza el catalogo guardado antes de pedirlo
  // de nuevo. El contenido igual se refresca en segundo plano en cada visita.
  MINUTOS_CACHE: 30,

};
