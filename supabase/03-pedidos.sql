-- ===================================================================
--  REGISTRO DE PEDIDOS DEL CATALOGO (version endurecida)
--
--  Correr DESPUES de 01-catalogo.sql y 02-sincronizacion.sql, y ANTES de
--  publicar el app.js que llama a registrar_pedido con p_ref.
--  Es seguro correrlo mas de una vez. No borra pedidos.
--
--  Que cambia respecto de la version anterior (auditoria):
--   H02  Idempotencia: cada intento logico de pedido trae un uuid (p_ref)
--        generado en el navegador. Reintentar con el mismo uuid devuelve el
--        pedido ya registrado en lugar de duplicarlo. Devuelve id, lineas y
--        total calculados por el servidor.
--   H03  Limite de frecuencia por IP y global. Mitiga el relleno con pedidos
--        falsos; NO reemplaza un endpoint de servidor con anti-robots
--        (ver Fase 3 del plan). La IP sale de las cabeceras que agrega el
--        proxy de Supabase.
--   H07  Validacion estricta: rechaza ids inexistentes, despublicados o sin
--        stock, cantidades invalidas (antes se convertian en 1), ids
--        repetidos y pedidos con pedidos_activos = 'no'. Nada de pedidos
--        parciales: o entra entero o no entra.
--   H09  El precio de la linea por caja se redondea a centavos y despues se
--        multiplica por la cantidad. El navegador hace exactamente la misma
--        cuenta (precioDeLinea en app.js).
--   H10  Rechaza pedidos con monedas mezcladas y guarda la moneda.
-- ===================================================================

alter table pedidos_catalogo add column if not exists ref       uuid;
alter table pedidos_catalogo add column if not exists moneda    text not null default 'ARS';
alter table pedidos_catalogo add column if not exists origen_ip text not null default '';

create unique index if not exists pedidos_catalogo_ref_key on pedidos_catalogo (ref);
create index if not exists pedidos_catalogo_ip_idx on pedidos_catalogo (origen_ip, creado_en desc);

-- La version vieja (sin p_ref) no tenia limites: primero se le quita el
-- permiso a la clave publica (asi queda cerrada aunque el drop no corra) y
-- despues se elimina.
do $$ begin
  revoke all on function public.registrar_pedido(text, text, jsonb) from public, anon, authenticated;
exception when undefined_function then null;
end $$;
drop function if exists public.registrar_pedido(text, text, jsonb);

-- ── LOGICA DEL REGISTRO (interna) ───────────────────────────────────
-- La usan las dos puertas de abajo. Recibe la IP del cliente ya resuelta:
-- registrar_pedido la toma de las cabeceras; registrar_pedido_verificado la
-- recibe de la Edge Function (si no, todos los pedidos parecerian venir del
-- servidor de Supabase y compartirian el mismo cupo).
create or replace function public._registrar_pedido(p_ip text, p_ref uuid, p_cliente text, p_nota text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Limites. Ajustar aca si el negocio crece.
  c_max_por_ip_10min constant int := 5;
  c_max_por_ip_dia   constant int := 30;
  c_max_global_hora  constant int := 150;

  v_ip       text := coalesce(nullif(btrim(p_ip), ''), 'desconocida');
  v_id       uuid;
  v_total    numeric(14,2);
  v_moneda   text;
  v_malos    text;
  v_lineas   jsonb;
  v_existe   pedidos_catalogo%rowtype;
begin
  -- ── Formato ──────────────────────────────────────────────────────
  if p_ref is null then
    raise exception using errcode = 'P0001', hint = 'formato',
      message = 'Falta la referencia del pedido.';
  end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception using errcode = 'P0001', hint = 'formato',
      message = 'El pedido no tiene el formato esperado.';
  end if;
  if jsonb_array_length(p_items) not between 1 and 100 then
    raise exception using errcode = 'P0001', hint = 'limite_lineas',
      message = 'El pedido tiene que tener entre 1 y 100 productos.';
  end if;

  -- ── Idempotencia ─────────────────────────────────────────────────
  -- El lock por ref serializa dos envios simultaneos del mismo pedido.
  perform pg_advisory_xact_lock(hashtextextended('pedido:' || p_ref::text, 0));
  select * into v_existe from pedidos_catalogo where ref = p_ref;
  if found then
    return jsonb_build_object(
      'id', v_existe.id, 'ref', v_existe.ref, 'total', v_existe.total_estimado,
      'moneda', v_existe.moneda, 'duplicado', true,
      'lineas', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', i.producto_id, 'cantidad', i.cantidad, 'precio', i.precio) order by i.id)
                from pedidos_catalogo_items i where i.pedido_id = v_existe.id), '[]'::jsonb));
  end if;

  -- ── Validacion de cada linea (antes de escribir nada) ────────────
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where jsonb_typeof(e) is distinct from 'object'
       or jsonb_typeof(e->'id') is distinct from 'string'
       or length(e->>'id') not between 1 and 64
       or jsonb_typeof(e->'cantidad') is distinct from 'number'
       or (e->>'cantidad') !~ '^[0-9]{1,3}$'
       or (e->>'cantidad')::int < 1
  ) then
    raise exception using errcode = 'P0001', hint = 'cantidad_invalida',
      message = 'Hay productos con cantidades invalidas (tienen que ser enteros de 1 a 999).';
  end if;

  if (select count(*) from jsonb_array_elements(p_items))
     <> (select count(distinct e->>'id') from jsonb_array_elements(p_items) e) then
    raise exception using errcode = 'P0001', hint = 'ids_repetidos',
      message = 'El pedido trae el mismo producto mas de una vez.';
  end if;

  if lower(coalesce((select valor from config where clave = 'pedidos_activos'), 'si')) = 'no' then
    raise exception using errcode = 'P0001', hint = 'pedidos_cerrados',
      message = 'Por ahora no estamos tomando pedidos desde el catalogo.';
  end if;

  select string_agg(e->>'id', ',')
    into v_malos
  from jsonb_array_elements(p_items) e
  left join productos pr on pr.id = e->>'id' and pr.publicado and not pr.sin_stock
  where pr.id is null;
  if v_malos is not null then
    raise exception using errcode = 'P0001', hint = 'productos_no_disponibles', detail = v_malos,
      message = 'Algunos productos ya no estan disponibles.';
  end if;

  if (select count(distinct pr.moneda) from jsonb_array_elements(p_items) e
      join productos pr on pr.id = e->>'id') > 1 then
    raise exception using errcode = 'P0001', hint = 'monedas_mezcladas',
      message = 'El pedido mezcla productos con monedas distintas.';
  end if;

  -- ── Limite de frecuencia ─────────────────────────────────────────
  -- Sin IP identificable no se aplica el limite por IP: si no, todos los
  -- clientes compartirian el mismo cupo de 5 pedidos. Queda el global.
  perform pg_advisory_xact_lock(hashtextextended('ip:' || v_ip, 0));
  if (v_ip <> 'desconocida' and (
        (select count(*) from pedidos_catalogo where origen_ip = v_ip and creado_en > now() - interval '10 minutes') >= c_max_por_ip_10min
     or (select count(*) from pedidos_catalogo where origen_ip = v_ip and creado_en > now() - interval '1 day') >= c_max_por_ip_dia))
     or (select count(*) from pedidos_catalogo where creado_en > now() - interval '1 hour') >= c_max_global_hora then
    -- PT429: PostgREST responde HTTP 429.
    raise exception using errcode = 'PT429', hint = 'demasiados_pedidos',
      message = 'Recibimos muchos pedidos seguidos. Proba de nuevo en unos minutos.';
  end if;

  -- ── Escritura ────────────────────────────────────────────────────
  select max(pr.moneda) into v_moneda
  from jsonb_array_elements(p_items) e join productos pr on pr.id = e->>'id';

  insert into pedidos_catalogo (ref, cliente, nota, moneda, origen_ip)
  values (p_ref,
          left(btrim(coalesce(p_cliente, '')), 300),
          left(btrim(coalesce(p_nota, '')), 300),
          coalesce(v_moneda, 'ARS'),
          left(v_ip, 64))
  returning id into v_id;

  -- Precio de la linea: por caja cerrada se redondea a centavos ANTES de
  -- multiplicar por la cantidad (igual que el navegador).
  insert into pedidos_catalogo_items (pedido_id, producto_id, nombre, precio, cantidad)
  select v_id, pr.id, pr.nombre,
         case when pr.precio is null then null
              when pr.solo_caja and pr.unidad_precio = 'unidad' and pr.unidades_caja > 1
                then round(pr.precio * pr.unidades_caja, 2)
              when pr.solo_caja and pr.unidad_precio = 'kg' and pr.kg_caja > 0
                then round(pr.precio * pr.kg_caja, 2)
              else pr.precio end,
         (e->>'cantidad')::int
  from jsonb_array_elements(p_items) with ordinality as t(e, n)
  join productos pr on pr.id = e->>'id'
  order by t.n;

  select coalesce(sum(coalesce(i.precio, 0) * i.cantidad), 0),
         coalesce(jsonb_agg(jsonb_build_object('id', i.producto_id, 'cantidad', i.cantidad, 'precio', i.precio) order by i.id), '[]'::jsonb)
    into v_total, v_lineas
  from pedidos_catalogo_items i where i.pedido_id = v_id;

  update pedidos_catalogo set total_estimado = v_total where id = v_id;

  return jsonb_build_object('id', v_id, 'ref', p_ref, 'total', v_total, 'moneda', coalesce(v_moneda, 'ARS'),
                            'duplicado', false, 'lineas', v_lineas);
end;
$$;

revoke all on function public._registrar_pedido(text, uuid, text, text, jsonb) from public, anon, authenticated;

-- ── PUERTA 1: directa desde el sitio (clave publica) ────────────────
-- La IP sale de las cabeceras que agrega el proxy de Supabase.
create or replace function public.registrar_pedido(p_ref uuid, p_cliente text, p_nota text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_headers json;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    v_headers := null;
  end;
  return public._registrar_pedido(
    coalesce(nullif(btrim(v_headers->>'cf-connecting-ip'), ''),
             nullif(btrim(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1)), '')),
    p_ref, p_cliente, p_nota, p_items);
end;
$$;

revoke all on function public.registrar_pedido(uuid, text, text, jsonb) from public, authenticated;
-- Solo la clave publica (anon): el sitio no usa usuarios con sesion.
-- [AUDITORIA H03] Cuando la verificacion anti-robots este activa (Turnstile),
-- este permiso se retira y la unica puerta queda la verificada:
--   revoke execute on function public.registrar_pedido(uuid, text, text, jsonb) from anon;
grant execute on function public.registrar_pedido(uuid, text, text, jsonb) to anon;

-- ── PUERTA 2: verificada (Edge Function registrar-pedido) ───────────
-- [AUDITORIA H03] La llama solo la Edge Function, con la clave service_role,
-- despues de verificar el token de Cloudflare Turnstile. Recibe la IP real
-- del cliente para que el limite por IP siga funcionando.
create or replace function public.registrar_pedido_verificado(p_ip text, p_ref uuid, p_cliente text, p_nota text, p_items jsonb)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public._registrar_pedido(p_ip, p_ref, p_cliente, p_nota, p_items);
$$;

revoke all on function public.registrar_pedido_verificado(text, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_pedido_verificado(text, uuid, text, text, jsonb) to service_role;

-- Para revisar abuso (SQL Editor):
--   select origen_ip, count(*) from pedidos_catalogo
--   where creado_en > now() - interval '1 day' group by 1 order by 2 desc limit 20;
