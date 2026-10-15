// PostToolUse (Edit/Write): revisa la sintaxis de cada .js/.cjs/.mjs editado
// con `node --check`. Si falla, sale con 2 para que Claude vea el error y lo
// corrija en el momento, sin gastar tokens en una validación aparte.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
let input;
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }
const t = (input && input.tool_input) || {};
if (typeof t.file_path !== 'string' || !/\.(c|m)?js$/i.test(t.file_path)) process.exit(0);
const file = path.resolve(input.cwd || process.cwd(), t.file_path);
if (!fs.existsSync(file)) process.exit(0);
const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 8000 });
if (r.status !== 0 && r.status !== null) {
  process.stderr.write('node --check falló en ' + t.file_path + ':\n' + (r.stderr || '').slice(0, 2000));
  process.exit(2);
}
