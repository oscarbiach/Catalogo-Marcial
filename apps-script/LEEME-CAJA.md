# Venta por caja cerrada en la planilla

Hasta ahora, qué productos se venden **solo por caja cerrada** estaba guardado en dos
tablas de Supabase. Si el sitio tenía que leer del Apps Script (el respaldo), esa
información se perdía y cambiaban cantidades y totales. Desde este cambio vive en la
planilla, en dos columnas nuevas al final de la hoja `Productos`:

| Columna | Qué va |
|---|---|
| `solo_caja` | `si` si el producto se vende solo por caja cerrada |
| `kg_caja` | Kilos de la caja, solo para productos con precio por kilo (por ejemplo `3,6`) |

Para los productos con precio por unidad, las unidades de la caja siguen saliendo de
`unidades_caja`.

## Instalación (una sola vez, en este orden)

1. **Copia de seguridad:** Archivo > Hacer una copia.
2. En el Apps Script del catálogo, reemplazar el contenido de `Codigo.gs` y
   `Productos.gs` por los de esta carpeta. Crear un archivo de script nuevo llamado
   `CajaCerrada` y pegar `CajaCerrada.gs`. Guardar.
3. **Publicar la versión nueva del Web App, sin cambiar la URL:** Implementar >
   Gestionar implementaciones > lápiz de la implementación activa > Versión: *Nueva
   versión* > Implementar. (Si se crea una implementación nueva, la URL cambia y el
   sitio y Supabase dejan de encontrarla.)
4. Ejecutar `cc_simular`. **No escribe nada:** muestra en el registro qué celdas
   va a completar y avisa si algo no coincide.
5. Si el registro está bien, ejecutar `cc_aplicar`. Completa las dos columnas con
   las 42 reglas que había en Supabase, completa `unidades_caja` donde faltaba,
   anota todo en `Historial fichas` y activa el contrato nuevo.

Antes de escribir, `cc_aplicar` comprueba que las columnas de la hoja estén en el
orden que espera el código. Si encuentra algo distinto, no toca nada y lo dice.

Para volver atrás sin tocar la planilla: `cc_desactivar` (Supabase vuelve a usar
sus tablas).

## Cómo marcar un producto nuevo

- Precio por unidad que se vende por caja: `solo_caja` = `si` y `unidades_caja`
  con las unidades de la caja.
- Precio por kilo que se vende por caja: `solo_caja` = `si` y `kg_caja` con los
  kilos de la caja.

En la próxima sincronización (cada 10 minutos) Supabase copia las reglas. Si de
golpe desaparece más de la mitad, la sincronización se frena y llega el aviso por
correo de la vigilancia horaria.

Guardar un producto desde el panel **no** borra estas dos columnas: si el panel no
las manda, se conservan.
