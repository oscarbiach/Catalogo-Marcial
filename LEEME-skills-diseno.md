# Paquete de skills de diseño (Marcial)

Contenido
- `.claude/skills/` → impeccable, emil-design-eng, design-taste-frontend (copiadas sin editar de sus fuentes, ver `SOURCES.md`) y `awesome-design/SKILL.md` (envoltorio propio; la colección se descarga con el instalador).
- `CLAUDE-parrafo-diseno.md` → párrafo para pegar en el `CLAUDE.md` del otro proyecto.
- `instalar-skills.ps1` (Windows) / `instalar-skills.sh` (Mac/Linux) → instala Playwright CLI y su skill, y baja Awesome Design.

Pasos
1. Copiá la carpeta `.claude` de este paquete a la raíz del otro proyecto (si ya tiene una, copiá solo `skills`; no pises archivos existentes sin respaldo).
2. Pegá el contenido de `CLAUDE-parrafo-diseno.md` en el `CLAUDE.md` del otro proyecto.
3. En una terminal parada en la raíz del otro proyecto: `.\instalar-skills.ps1` (Windows PowerShell) o `bash instalar-skills.sh`.
   Si PowerShell bloquea el script: `powershell -ExecutionPolicy Bypass -File .\instalar-skills.ps1`
4. Abrí una sesión nueva de Claude Code en ese proyecto.

Notas
- Playwright CLI: `npm install -g @playwright/cli@latest` y `playwright-cli install --skills` (Node 18+). Fuente: https://github.com/microsoft/playwright-cli
- Awesome Design: https://github.com/VoltAgent/awesome-design-md (MIT). No es una skill oficial: es una carpeta de DESIGN.md por marca; el `SKILL.md` incluido (propio de este paquete) enseña a Claude a usarla.
- `impeccable` descarga su motor desde GitHub la primera vez que se usa (necesita internet).
