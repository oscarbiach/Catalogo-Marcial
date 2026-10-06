# Skills de diseno para Claude Code

Instalacion local al repositorio: tres skills principales, copiadas completas desde sus fuentes originales, sin editar su contenido. No requiere instalar los repositorios completos ni dependencias de frontend.

| Skill | Fuente | Commit |
| --- | --- | --- |
| impeccable | https://github.com/pbakaus/impeccable | f2c7051853848826aac2f4646581d62a732155ad |
| design-taste-frontend | https://github.com/Leonxlnx/taste-skill | e79ca9ec7e071eb3a3b623c4fb752e853fc3ed58 |
| emil-design-eng | https://github.com/emilkowalski/skills | 85e8e2363b713506e1d5b6e07a0eb2da66be1bc3 |

Origen de carpetas: `plugin/skills/impeccable`, `skills/taste-skill` y `skills/emil-design-eng`, respectivamente. Licencias y NOTICE de Impeccable incluidos. Se instalo la skill principal de cada proyecto, no todas sus skills opcionales.

Claude Code descubre `.claude/skills/` al abrir este repositorio. Comandos: `/impeccable`, `/design-taste-frontend`, `/emil-design-eng`. Si una sesion previa no las muestra, abrir una nueva sesion con la rama que contiene estos archivos.

Impeccable incluye su lanzador Windows/POSIX y referencias. Su motor 0.1.5 se descarga desde GitHub al primer uso, con verificacion de checksum por el lanzador; requiere acceso de red en ese entorno. La instalacion manual no agrega hooks automaticos ni modifica permisos de Claude. Si el lanzador falla, la propia skill documenta el uso directo del contexto y referencias.

Para actualizar, comparar contra nuevas versiones oficiales y conservar las adaptaciones del proyecto en CLAUDE.md. No sobreescribir skills ni configuracion sin respaldo.
