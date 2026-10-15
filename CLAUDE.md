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
