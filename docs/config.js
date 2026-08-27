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
  API: 'PEGAR_ACA_LA_URL_DEL_WEB_APP',

  // Minutos que el navegador reutiliza el catalogo guardado antes de pedirlo
  // de nuevo. El contenido igual se refresca en segundo plano en cada visita.
  MINUTOS_CACHE: 30,

};
