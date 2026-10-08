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
--    (registrar_pedido, la unica forma de que el sitio escriba un pedido, esta en 03-pedidos.sql)
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
  unidad_precio  text not null default '' check (unidad_precio in ('', 'kg', 'unidad', 'caja')), -- por que unidad es el precio y se pide ('' = automatico)
  imagenes       text[] not null default '{}',-- ids de archivo de Google Drive
  rubros         text[] not null default '{}',
  destacado      boolean not null default false,
  nuevo          boolean not null default false,
  sin_stock      boolean not null default false,
  posicion       int  not null default 0,     -- el lugar en la lista: el catalogo llega ordenado por lo mas pedido
  orden          int  not null default 0,     -- el numero de orden de la planilla
  publicado      boolean not null default true,
  actualizado_en timestamptz not null default now()
);

alter table productos add column if not exists unidad_precio text not null default '' check (unidad_precio in ('', 'kg', 'unidad', 'caja'));

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
-- [AUDITORIA H03/H07] La funcion registrar_pedido vive en 03-pedidos.sql:
-- depende de columnas que crea 02-sincronizacion.sql (solo_caja, kg_caja) y
-- ahora tiene limite de frecuencia, idempotencia y validacion estricta.
-- Antes estaba aca; volver a correr este archivo ya no la recrea ni le
-- devuelve permisos a la version vieja.

-- ── CONTROL ─────────────────────────────────────────────────────────
-- Despues de correr esto: 4 tablas con la seguridad activada ("t").
select relname as tabla, relrowsecurity as seguridad_activada
from pg_class
where relname in ('productos', 'config', 'pedidos_catalogo', 'pedidos_catalogo_items')
order by 1;
