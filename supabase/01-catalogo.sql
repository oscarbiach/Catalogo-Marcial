-- ===================================================================
--  CATALOGO PUBLICO DE MARCIAL - base de datos en Supabase
--
--  Va en un proyecto de Supabase APARTE de la app de pedidos: la clave
--  publica del sitio solo ve estas tablas, nunca clientes ni PINs.
--
--  Que crea:
--    productos          lo que se muestra en el catalogo (lo llena la planilla)
--    config             textos del sitio: nombre, WhatsApp, titulo, listas
--    pedidos_catalogo   pedidos que los clientes mandan desde el sitio
--    registrar_pedido   la unica forma de que el sitio escriba un pedido
--
--  Es seguro correrlo mas de una vez. No borra datos.
--  Pegar entero en: Supabase > SQL Editor > New query > Run.
-- ===================================================================

-- ── PRODUCTOS ───────────────────────────────────────────────────────
create table if not exists productos (
  id             text primary key,            -- el id de la planilla
  sku            text not null default '',
  nombre         text not null,
  descripcion    text not null default '',
  categoria      text not null default '',
  marca          text not null default '',
  precio         numeric(12,2),               -- null = sin precio, el sitio no lo muestra
  moneda         text not null default 'ARS',
  unidades_caja  int  not null default 0,
  presentacion   text not null default '',
  imagenes       text[] not null default '{}',-- ids de archivo de Google Drive
  rubros         text[] not null default '{}',
  destacado      boolean not null default false,
  nuevo          boolean not null default false,
  sin_stock      boolean not null default false,
  posicion       int  not null default 0,     -- el orden que manda la planilla
  orden          int  not null default 0,     -- cuantas veces se pidio: lo suma registrar_pedido
                                              -- (la sincronizacion NO lo pisa)
  publicado      boolean not null default true,
  actualizado_en timestamptz not null default now()
);

create index if not exists productos_orden_idx on productos (posicion, nombre) where publicado;

-- ── CONFIG ──────────────────────────────────────────────────────────
-- Una fila por dato. Las que empiezan con guion bajo (_categorias, _marcas,
-- _rubros) guardan una lista ya ordenada, escrita como JSON.
-- IMPORTANTE: todo lo que se escriba aca lo puede leer cualquiera que abra
-- el sitio. No guardar claves ni datos privados.
create table if not exists config (
  clave text primary key,
  valor text not null default ''
);

-- ── PEDIDOS DEL CATALOGO ────────────────────────────────────────────
create table if not exists pedidos_catalogo (
  id              uuid primary key default gen_random_uuid(),
  creado_en       timestamptz not null default now(),
  cliente         text not null default '',
  nota            text not null default '',
  total_estimado  numeric(14,2) not null default 0
);

create table if not exists pedidos_catalogo_items (
  id           bigint generated always as identity primary key,
  pedido_id    uuid not null references pedidos_catalogo(id) on delete cascade,
  producto_id  text references productos(id) on delete set null,
  nombre       text not null,                  -- copia del nombre al momento del pedido
  precio       numeric(12,2),                  -- precio de la base, no el que diga el navegador
  cantidad     int not null check (cantidad between 1 and 999)
);

create index if not exists pedidos_catalogo_fecha_idx on pedidos_catalogo (creado_en desc);

-- ── SEGURIDAD ───────────────────────────────────────────────────────
-- Regla de oro: el sitio (clave "anon") solo LEE productos publicados y
-- config, y solo puede ESCRIBIR llamando a registrar_pedido. No puede leer
-- pedidos, ni tocar productos.
alter table productos               enable row level security;
alter table config                  enable row level security;
alter table pedidos_catalogo        enable row level security;
alter table pedidos_catalogo_items  enable row level security;

drop policy if exists "leer productos publicados" on productos;
create policy "leer productos publicados" on productos
  for select to anon, authenticated using (publicado);

drop policy if exists "leer config" on config;
create policy "leer config" on config
  for select to anon, authenticated using (true);

-- pedidos_catalogo y pedidos_catalogo_items: sin ninguna politica = nadie
-- con la clave publica los puede ver ni escribir directo.

revoke all on productos, config, pedidos_catalogo, pedidos_catalogo_items from anon, authenticated;
grant select on productos, config to anon, authenticated;

-- ── REGISTRAR UN PEDIDO ─────────────────────────────────────────────
-- Recibe solo ids y cantidades. Nombre y precio los pone la base con lo que
-- hay en productos, asi nadie puede mandar un precio inventado.
-- Ejemplo de llamada:
--   select registrar_pedido('Panaderia Sur', 'Entregar a la tarde',
--          '[{"id":"p1","cantidad":2}]'::jsonb);
create or replace function registrar_pedido(p_cliente text, p_nota text, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_total  numeric(14,2) := 0;
  v_validos int := 0;
  r        record;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'El pedido no tiene el formato esperado.';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    raise exception 'El pedido tiene una cantidad de productos fuera de rango.';
  end if;

  insert into pedidos_catalogo (cliente, nota)
  values (left(coalesce(p_cliente, ''), 300), left(coalesce(p_nota, ''), 300))
  returning id into v_id;

  for r in
    select pr.id, pr.nombre, pr.precio, it.cantidad
    from (
      select e->>'id' as id,
             case when (e->>'cantidad') ~ '^[0-9]{1,3}$' and (e->>'cantidad')::int >= 1
                  then (e->>'cantidad')::int else 1 end as cantidad
      from jsonb_array_elements(p_items) e
    ) it
    join productos pr on pr.id = it.id and pr.publicado
  loop
    insert into pedidos_catalogo_items (pedido_id, producto_id, nombre, precio, cantidad)
    values (v_id, r.id, r.nombre, r.precio, r.cantidad);

    v_total   := v_total + coalesce(r.precio, 0) * r.cantidad;
    v_validos := v_validos + 1;

    -- Lo mas pedido sube solo en el orden del sitio
    update productos set orden = orden + 1 where id = r.id;
  end loop;

  if v_validos = 0 then
    raise exception 'Ningun producto del pedido existe en el catalogo.';
  end if;

  update pedidos_catalogo set total_estimado = v_total where id = v_id;
end;
$$;

revoke all on function registrar_pedido(text, text, jsonb) from public;
grant execute on function registrar_pedido(text, text, jsonb) to anon, authenticated;

-- ── CONTROL ─────────────────────────────────────────────────────────
-- Despues de correr esto: 4 tablas con la seguridad activada ("t").
select relname as tabla, relrowsecurity as seguridad_activada
from pg_class
where relname in ('productos', 'config', 'pedidos_catalogo', 'pedidos_catalogo_items')
order by 1;
