---
name: awesome-design
description: Usar cuando el pedido sea construir o ajustar una interfaz "al estilo de" una marca conocida (Stripe, Linear, Notion, Figma, Raycast, etc.) o cuando haga falta un DESIGN.md de referencia para el proyecto. Contiene la colección awesome-design-md (DESIGN.md por marca) para leer sus colores, tipografía, espaciado y componentes.
---

# Awesome Design (colección DESIGN.md)

Esta skill es un envoltorio simple sobre el repositorio https://github.com/VoltAgent/awesome-design-md (licencia MIT). El repositorio NO trae una skill propia: es una carpeta `design-md/` con un `DESIGN.md` por marca (más `preview.html` y `preview-dark.html`).

## Cómo usarla
1. Mirá las marcas disponibles en `design-md/` (junto a este archivo).
2. Abrí `design-md/<marca>/DESIGN.md` de la marca pedida y usalo como guía de colores, tipografía, espaciado, bordes, sombras y componentes. Lee solo esa marca, no toda la colección.
3. Si el usuario quiere fijar un estilo para el proyecto, copiá ese archivo a la raíz del proyecto como `DESIGN.md` y referencialo desde `CLAUDE.md`.
4. Si ya existe un sistema visual propio del proyecto (tokens, identidad, `DESIGN.md`), ese manda: estas marcas son referencia, no una orden de rediseño.
5. Mantené la arquitectura y las dependencias del proyecto: los ejemplos son guía de estilo, no autorización para migrar de tecnología.

Si falta la carpeta `design-md/`, corré el instalador del paquete (`instalar-skills`) o clonala:
`git clone --depth 1 https://github.com/VoltAgent/awesome-design-md` y copiá su carpeta `design-md/` junto a este archivo.
