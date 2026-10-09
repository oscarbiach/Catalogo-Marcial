# Verificación anti-robots de los pedidos (Cloudflare Turnstile)

Hoy cualquiera que tenga la clave pública del sitio puede registrar pedidos
directo en la base. El límite por IP frena el abuso masivo, pero no lo
impide. Con Turnstile, cada pedido tiene que pasar primero una verificación
de Cloudflare. Para la mayoría de los clientes es invisible: solo aparece una
casilla si Cloudflare sospecha.

**Ya está todo instalado y apagado:**

- la Edge Function `registrar-pedido` en Supabase;
- la función `registrar_pedido_verificado` en la base;
- el widget en el sitio.

Para encenderla solo hacen falta las claves.

## 1. Crear el widget en Cloudflare (gratis)

1. Entrar a <https://dash.cloudflare.com> (crear cuenta si no hay).
2. Menú **Turnstile** > **Add widget**.
3. Nombre: `Catalogo Marcial`. Dominios: `distribuidoramarcial.com`, `www.distribuidoramarcial.com` y `oscarbiach.github.io`.
4. Modo: **Managed**. Crear.
5. Quedan dos claves:
   - **Site Key** (pública): va en el sitio.
   - **Secret Key** (secreta): va **solo** en Supabase. Nunca en el repositorio, en `config.js` ni en un chat.

## 2. Cargar la clave secreta en Supabase

Supabase > proyecto **Catalago Marcial** > **Edge Functions** > **Secrets** > Add new secret:

| Nombre | Valor |
|---|---|
| `TURNSTILE_SECRET` | la Secret Key de Cloudflare |

## 3. Cargar la clave pública en el sitio

En `docs/config.js`:

```js
TURNSTILE: {
  siteKey: 'PEGAR_ACA_LA_SITE_KEY',
},
```

Subir `?v=N` de `config.js` en `index.html` y publicar.

## 4. Probar y cerrar la puerta directa

1. Hacer un pedido de prueba desde el sitio. En el panel tiene que decir **"Pedido registrado."**.
2. En el SQL Editor:
   ```sql
   select creado_en, origen_ip, total_estimado from pedidos_catalogo order by creado_en desc limit 1;
   ```
   `origen_ip` tiene que ser la IP real (no `desconocida`).
3. Recién entonces, cerrar la puerta directa para que **solo** se registre lo verificado:
   ```sql
   revoke execute on function public.registrar_pedido(uuid, text, text, jsonb) from anon;
   ```

**Para volver atrás:** vaciar `siteKey` en `config.js` y devolver el permiso con
`grant execute on function public.registrar_pedido(uuid, text, text, jsonb) to anon;`.

## Qué pasa si Cloudflare falla

WhatsApp se abre igual: el pedido le llega al negocio. Lo único que no se
guarda es el registro en la base, y el panel lo avisa ("No pudimos registrar
el pedido... Igual podés mandarlo por WhatsApp").
