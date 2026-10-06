#!/usr/bin/env bash
# Instala en el proyecto ACTUAL: Playwright CLI (+ su skill) y la colección Awesome Design.
# Uso (parado en la raíz del otro proyecto):  bash instalar-skills.sh
# Requiere: Node.js 18+, npm y git.
set -euo pipefail
for c in node npm git; do command -v "$c" >/dev/null || { echo "Falta instalar: $c"; exit 1; }; done

echo "1/3  Playwright CLI..."
npm install -g @playwright/cli@latest
playwright-cli install --skills      # copia la skill a .claude/skills/playwright-cli de ESTE proyecto

echo "2/3  Awesome Design (colección DESIGN.md)..."
dest="$(pwd)/.claude/skills/awesome-design"; mkdir -p "$dest"
tmp="$(mktemp -d)"
git clone --depth 1 https://github.com/VoltAgent/awesome-design-md "$tmp/repo"
[ -d "$dest/design-md" ] && mv "$dest/design-md" "$dest/design-md.respaldo-$(date +%Y%m%d%H%M%S)"
cp -r "$tmp/repo/design-md" "$dest/design-md"
[ -f "$tmp/repo/LICENSE" ] && cp "$tmp/repo/LICENSE" "$dest/LICENSE"
rm -rf "$tmp"
[ -f "$dest/SKILL.md" ] || echo "Aviso: falta .claude/skills/awesome-design/SKILL.md (viene en el zip: copiá la carpeta .claude primero)."

echo "3/3  Listo. Abrí una sesión nueva de Claude Code en este proyecto para que las detecte."
