## Skills de diseño instaladas

Disponibles en `.claude/skills/`, junto con sus referencias y licencias.
Ante pedidos de interfaz, selecciona la guía pertinente sin exigir que el usuario recuerde comandos:
- `impeccable`: diseño, revisión, accesibilidad y pulido de interfaces.
- `emil-design-eng`: detalles de componentes, transiciones y animaciones útiles.
- `design-taste-frontend`: páginas de presentación, portfolios y rediseños de ese tipo; su versión actual excluye dashboards, tablas y flujos de producto. No imponerla sobre pantallas de operación.
- `awesome-design`: referencias DESIGN.md por marca (Stripe, Linear, Notion…) cuando se pide un estilo "tipo X".
- `playwright-cli`: automatizar el navegador, probar y sacar capturas desde la línea de comandos.

Conserva el HTML/CSS/JavaScript y la arquitectura actual. Los ejemplos React, Tailwind o GSAP son referencias, no una autorización para migrar ni agregar dependencias. Respeta accesibilidad, movimiento reducido y las decisiones visuales existentes salvo pedido de rediseño.
Lee solo la skill y las referencias necesarias para la tarea. Las instrucciones del usuario y AGENTS.md prevalecen sobre las guías externas.
La instalación no autoriza un rediseño ni cambios en producción. Fuentes y versiones: `.claude/skills/SOURCES.md`.

## Orquestación de modelos (subagentes)

Subagentes del proyecto en `.claude/agents/`:
- `Explore` (Haiku 5.5, effort low, solo lectura): úsalo para localizar archivos, buscar símbolos y resumir logs o salidas de tests antes de decidir un cambio.
- `sonnet-coder` (Sonnet 5.5, effort medium): delégale la implementación cuando el cambio abarque varios archivos o requiera ejecutar pruebas, pasándole una especificación concreta. Los cambios chicos y puntuales hazlos directamente en la sesión principal.

La sesión principal conserva el diseño, las decisiones ambiguas y la revisión final del resultado de los subagentes. No cambies el modelo de la sesión hacia uno menor a mitad de conversación: delega en subagentes.

### Costo y contexto
- Esfuerzo: `Explore` queda en low y `sonnet-coder` en medium. No subas los subagentes a xhigh/max: en max, Haiku genera unos 162K tokens de salida por tarea y pierde su ventaja de costo. Lo difícil (depurar, decidir) queda en la sesión principal.
- Encargos acotados a los subagentes: qué buscar y en qué carpeta, sin pegar archivos enteros; que devuelvan solo la síntesis. Así cada uno queda muy por debajo de 100K tokens (por encima, Haiku cobra 5 veces más).
- Este CLAUDE.md se carga y cachea al iniciar cada sesión: mantenlo corto y estable. Lo pendiente va en `auditoria/PENDIENTES.md`, no aquí.
- Escrituras en GitHub dosificadas: nada de decenas de commits, comentarios o issues en ráfaga, para no chocar con los límites secundarios de GitHub.
- El hook `.claude/hooks/check-js.cjs` corre `node --check` sobre cada `.js/.cjs/.mjs` editado y devuelve el error en el momento. No cubre el script embebido en `index.html`: eso sigue en la validación habitual.

### Operaciones de negocio (pedidos, cobros, comprobantes, stock)
- Toda operación que crea o cambia datos debe ser idempotente: el id se genera una sola vez por operación (como la referencia `p_ref` que `docs/assets/js/app.js` envía a `registrar_pedido`) y nunca de nuevo en cada reintento, y el botón queda deshabilitado mientras la solicitud está en curso. Al tocar estos flujos, verifica que se mantenga.
- Las pruebas nunca envían formularios ni datos a servicios reales: Supabase y Apps Script simulados, como en `pruebas/regresion.js`.
