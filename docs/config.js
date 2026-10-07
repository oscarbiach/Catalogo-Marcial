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
  // portada pasa a decir "Ver lista completa" y abre el PDF en otra pestania.
  // Vacio: el boton sigue llevando al catalogo. Es un enlace de Drive con
  // acceso "cualquiera con el enlace"; el PDF no debe incluir costos.
  LISTA_PDF: '',

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

  // Minutos que el navegador reutiliza el catalogo guardado antes de pedirlo
  // de nuevo. El contenido igual se refresca en segundo plano en cada visita.
  MINUTOS_CACHE: 30,

};
