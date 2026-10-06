# Instala en el proyecto ACTUAL: Playwright CLI (+ su skill) y la colección Awesome Design.
# Uso (PowerShell, parado en la carpeta raíz del otro proyecto):  .\instalar-skills.ps1
# Requiere: Node.js 18 o más nuevo, npm y git.
$ErrorActionPreference = 'Stop'
foreach ($c in 'node','npm','git') { if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { throw "Falta instalar: $c" } }

Write-Host '1/3  Playwright CLI...'
npm install -g @playwright/cli@latest
playwright-cli install --skills      # copia la skill a .claude/skills/playwright-cli de ESTE proyecto

Write-Host '2/3  Awesome Design (colección DESIGN.md)...'
$dest = Join-Path (Get-Location) '.claude/skills/awesome-design'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('awesome-design-md-' + [guid]::NewGuid())
git clone --depth 1 https://github.com/VoltAgent/awesome-design-md $tmp
if (Test-Path (Join-Path $dest 'design-md')) { Rename-Item (Join-Path $dest 'design-md') ("design-md.respaldo-" + (Get-Date -Format yyyyMMddHHmmss)) }
Copy-Item (Join-Path $tmp 'design-md') (Join-Path $dest 'design-md') -Recurse
if (Test-Path (Join-Path $tmp 'LICENSE')) { Copy-Item (Join-Path $tmp 'LICENSE') (Join-Path $dest 'LICENSE') }
Remove-Item $tmp -Recurse -Force
if (-not (Test-Path (Join-Path $dest 'SKILL.md'))) { Write-Host 'Aviso: falta .claude/skills/awesome-design/SKILL.md (viene en el zip: copiá la carpeta .claude primero).' }

Write-Host '3/3  Listo. Abrí una sesión nueva de Claude Code en este proyecto para que las detecte.'
