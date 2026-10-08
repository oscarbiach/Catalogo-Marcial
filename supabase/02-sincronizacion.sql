-- ===================================================================
--  SINCRONIZACION PLANILLA -> SUPABASE
--
--  La planilla sigue siendo donde se edita. Cada 10 minutos, Supabase
--  lee el endpoint publico del catalogo del Apps Script (?action=catalog)
--  y copia el resultado a las tablas. Es lo mismo que hacia la tarea
--  programada que antes alimentaba otra base: no hay que pegar nada en el Apps Script.
--
--  Reglas (iguales a las de Espejo.gs):
--   - Cada producto se inserta o actualiza por su id.
--   - El catalogo llega ordenado por lo mas pedido: el lugar en la lista
--     queda en `posicion`. `orden` es el numero de orden de la planilla.
--   - Lo que ya no esta activo en la planilla queda publicado = false:
--     sale del sitio pero no se borra.
--   - Si el catalogo llega vacio o con menos de la mitad de lo publicado,
--     no se toca nada (red de seguridad).
--   - Cada corrida deja una fila en sincronizacion_log.
--   - Un lote con datos invalidos se rechaza entero (no se toca nada).
--   - Monitoreo: select * from estado_sincronizacion;
--
--  Requiere las extensiones http y pg_cron. Se corre en el SQL Editor,
--  despues de 01-catalogo.sql. Se puede volver a correr sin romper nada.
--  OJO: la URL del Apps Script va dentro de la funcion; si cambia, hay que
--  volver a correr este archivo con la nueva.
-- ===================================================================

create extension if not exists http with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create table if not exists sincronizacion_log (
  id         bigint generated always as identity primary key,
  creado_en  timestamptz not null default now(),
  ok         boolean not null,
  detalle    text not null default ''
);
alter table sincronizacion_log enable row level security;
revoke all on sincronizacion_log from anon, authenticated;

-- Columna nueva: por que unidad es el precio (kg, unidad o caja). Vacio = automatico.
alter table productos add column if not exists unidad_precio text not null default '' check (unidad_precio in ('', 'kg', 'unidad', 'caja'));

-- Productos que se piden solo por caja cerrada aunque la planilla no tenga
-- cargadas las unidades por caja. Si la planilla trae el dato, manda la planilla.
-- Se administra a mano (SQL Editor); nadie con la clave publica la ve.
create table if not exists caja_cerrada (
  producto_id text primary key,
  unidades    int not null check (unidades > 1)
);
alter table caja_cerrada enable row level security;
revoke all on caja_cerrada from anon, authenticated;

-- Productos con precio por kilo que se piden por caja cerrada (kilos de la caja).
create table if not exists caja_cerrada_kg (
  producto_id text primary key,
  kg          numeric(8,3) not null check (kg > 0)
);
alter table caja_cerrada_kg enable row level security;
revoke all on caja_cerrada_kg from anon, authenticated;

-- productos.solo_caja y kg_caja se completan solos a partir de las dos listas (trigger).
alter table productos add column if not exists solo_caja boolean not null default false;
alter table productos add column if not exists kg_caja numeric(8,3) not null default 0;
-- [AUDITORIA H01] Con contrato 2, aplicar_catalogo trae solo_caja y kg_caja
-- de la planilla y lo avisa con catalogo.reglas_planilla = '1' (local a la
-- transaccion): ahi el trigger no los pisa. Si no, se calculan desde las
-- listas, como antes.
create or replace function public.productos_marcar_solo_caja() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('catalogo.reglas_planilla', true), '') = '1' then
    return new;
  end if;
  new.kg_caja := coalesce((select k.kg from caja_cerrada_kg k where k.producto_id = new.id), 0);
  new.solo_caja := new.kg_caja > 0 or exists (select 1 from caja_cerrada c where c.producto_id = new.id);
  return new;
end $$;
-- Se puede volver a correr el archivo: el trigger se recrea en lugar de fallar.
drop trigger if exists productos_solo_caja on productos;
create trigger productos_solo_caja before insert or update on productos
  for each row execute function public.productos_marcar_solo_caja();

-- ── APLICAR UN CATALOGO YA DESCARGADO ───────────────────────────────
-- [AUDITORIA H04] Antes la validacion usaba `jsonb_typeof(...) <> 'array'`.
-- Si faltaba `productos`, eso da NULL, el IF no disparaba, no se insertaba
-- nada y el UPDATE final despublicaba TODO el catalogo, registrandolo como
-- exito. Ahora:
--   * las propiedades obligatorias se comparan con IS DISTINCT FROM (NULL = invalido);
--   * se valida el lote entero ANTES de escribir: ids unicos, precios y
--     unidades con formato numerico; un dato malo rechaza todo el lote;
--   * el umbral de "menos de la mitad" cuenta solo productos validos y unicos;
--   * las filas sin id (renglones en blanco de la planilla) se ignoran, pero no
--     cuentan para el umbral.
-- La descarga (http) quedo separada en sincronizar_catalogo(): esta funcion es
-- pura y se puede probar con un JSON a mano en un entorno aislado.
create or replace function public.aplicar_catalogo(j jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_validos   int;
  v_unicos    int;
  v_malos     text;
  v_pub       int;
  v_ahora     timestamptz := now();
  v_ocultos   int := 0;
  v_config    int := 0;
  v_contrato  int;
  v_reglas_antes  int;
  v_reglas_nuevas int;
begin
  if j is null
     or coalesce(j->>'ok', '') <> 'true'
     or jsonb_typeof(j->'productos') is distinct from 'array'
     or jsonb_typeof(j->'config') is distinct from 'object' then
    raise exception 'Contrato de catalogo invalido: faltan ok, productos (array) o config (objeto)';
  end if;

  -- Cada elemento tiene que ser un objeto.
  if exists (select 1 from jsonb_array_elements(j->'productos') e where jsonb_typeof(e) is distinct from 'object') then
    raise exception 'Contrato de catalogo invalido: hay productos que no son objetos';
  end if;

  -- Formatos numericos: se valida todo antes de tocar una sola fila.
  select string_agg(coalesce(nullif(p->>'id', ''), '(sin id)'), ', ')
    into v_malos
  from jsonb_array_elements(j->'productos') p
  where coalesce(p->>'id', '') <> ''
    and (
      (coalesce(p->>'precio', '') <> '' and (p->>'precio') !~ '^[0-9]+(\.[0-9]+)?$')
      or (coalesce(p->>'unidadesCaja', '') <> '' and (p->>'unidadesCaja') !~ '^[0-9]{1,6}$')
      or (coalesce(p->>'orden', '') <> '' and (p->>'orden') !~ '^-?[0-9]{1,9}$')
      or (coalesce(p->>'kgCaja', '') <> '' and (p->>'kgCaja') !~ '^[0-9]{1,4}(\.[0-9]+)?$')
      or coalesce(btrim(p->>'nombre'), '') = ''
    );
  if v_malos is not null then
    raise exception 'Productos con datos invalidos (precio, unidades, orden o nombre): %', left(v_malos, 300);
  end if;

  select count(*), count(distinct p->>'id')
    into v_validos, v_unicos
  from jsonb_array_elements(j->'productos') p
  where coalesce(p->>'id', '') <> '';

  if v_validos <> v_unicos then
    raise exception 'El catalogo trae ids repetidos (% filas, % ids distintos)', v_validos, v_unicos;
  end if;

  select count(*) into v_pub from productos where publicado;
  if v_unicos < 1 or (v_pub > 0 and v_unicos < v_pub * 0.5) then
    raise exception 'El catalogo llego con % productos validos y hay % publicados: no se sincroniza', v_unicos, v_pub;
  end if;

  -- [AUDITORIA H01] Contrato 2: la planilla es la fuente de la venta por caja
  -- cerrada (columnas solo_caja y kg_caja). Las tablas caja_cerrada y
  -- caja_cerrada_kg pasan a ser una copia que se rehace en cada vuelta, ANTES
  -- de actualizar productos, para que el trigger ya vea las reglas nuevas.
  -- Con contrato 1 (o sin contrato) las tablas no se tocan, como antes.
  -- Red de seguridad: si de golpe desaparece mas de la mitad de las reglas,
  -- se rechaza el lote (igual que con los productos).
  -- [AUDITORIA H01] Contrato 2: la planilla es la fuente de la venta por caja
  -- cerrada. solo_caja y kg_caja se escriben directo en productos y el
  -- trigger no los recalcula. Las tablas caja_cerrada* no se tocan: quedan
  -- como estaban, para volver al contrato 1 si hiciera falta.
  -- Red de seguridad: si de golpe desaparece mas de la mitad de los productos
  -- marcados, se rechaza el lote (igual que con los productos).
  v_contrato := case when coalesce(j->>'contrato', '') ~ '^[0-9]{1,3}$' then (j->>'contrato')::int else 1 end;
  if v_contrato >= 2 then
    select count(*) into v_reglas_nuevas
    from jsonb_array_elements(j->'productos') p
    where coalesce(p->>'id', '') <> ''
      and lower(coalesce(p->>'soloCaja', '')) in ('true', 't', '1', 'yes', 'si')
      and ((coalesce(p->>'kgCaja', '') <> '' and (p->>'kgCaja')::numeric > 0)
           or (coalesce(p->>'unidadPrecio', '') <> 'kg' and coalesce(p->>'unidadesCaja', '') <> ''
               and (p->>'unidadesCaja')::int > 1));
    select count(*) into v_reglas_antes from productos where publicado and solo_caja;
    if v_reglas_antes > 0 and v_reglas_nuevas < v_reglas_antes * 0.5 then
      raise exception 'Los productos por caja cerrada bajarian de % a %: no se sincroniza', v_reglas_antes, v_reglas_nuevas;
    end if;
    perform set_config('catalogo.reglas_planilla', '1', true);
  end if;

  insert into productos (id, sku, nombre, descripcion, categoria, marca, precio, moneda,
                         unidades_caja, presentacion, unidad_precio, imagenes, rubros,
                         destacado, nuevo, sin_stock, posicion, orden, publicado, actualizado_en,
                         solo_caja, kg_caja)
  select p->>'id',
         coalesce(p->>'sku', ''),
         btrim(p->>'nombre'),
         coalesce(p->>'descripcion', ''),
         coalesce(p->>'categoria', ''),
         coalesce(p->>'marca', ''),
         nullif(p->>'precio', '')::numeric,
         coalesce(nullif(p->>'moneda', ''), 'ARS'),
         case when coalesce(nullif(p->>'unidadesCaja', '')::int, 0) > 0
              then (p->>'unidadesCaja')::int
              when v_contrato >= 2 then 0
              else coalesce((select c.unidades from caja_cerrada c where c.producto_id = p->>'id'), 0) end,
         coalesce(p->>'presentacion', ''),
         case when p->>'unidadPrecio' in ('kg', 'unidad', 'caja') then p->>'unidadPrecio' else '' end,
         case when jsonb_typeof(p->'imagenes') = 'array'
              then coalesce((select array_agg(x) from jsonb_array_elements_text(p->'imagenes') x), '{}'::text[])
              else '{}'::text[] end,
         case when jsonb_typeof(p->'rubros') = 'array'
              then coalesce((select array_agg(x) from jsonb_array_elements_text(p->'rubros') x), '{}'::text[])
              else '{}'::text[] end,
         lower(coalesce(p->>'destacado', '')) in ('true', 't', '1', 'yes', 'on'),
         lower(coalesce(p->>'nuevo', '')) in ('true', 't', '1', 'yes', 'on'),
         lower(coalesce(p->>'sinStock', '')) in ('true', 't', '1', 'yes', 'on'),
         (t.i - 1)::int,
         coalesce(nullif(p->>'orden', '')::int, 0),
         true,
         v_ahora,
         -- Con contrato 1 el trigger los recalcula desde las listas.
         lower(coalesce(p->>'soloCaja', '')) in ('true', 't', '1', 'yes', 'si'),
         case when coalesce(p->>'kgCaja', '') <> '' then (p->>'kgCaja')::numeric else 0 end
  from jsonb_array_elements(j->'productos') with ordinality as t(p, i)
  where coalesce(p->>'id', '') <> ''
  on conflict (id) do update set
    sku = excluded.sku, nombre = excluded.nombre, descripcion = excluded.descripcion,
    categoria = excluded.categoria, marca = excluded.marca, precio = excluded.precio,
    moneda = excluded.moneda, unidades_caja = excluded.unidades_caja,
    presentacion = excluded.presentacion, unidad_precio = excluded.unidad_precio, imagenes = excluded.imagenes, rubros = excluded.rubros,
    destacado = excluded.destacado, nuevo = excluded.nuevo, sin_stock = excluded.sin_stock,
    posicion = excluded.posicion, orden = excluded.orden, publicado = true,
    actualizado_en = excluded.actualizado_en,
    solo_caja = excluded.solo_caja, kg_caja = excluded.kg_caja;

  perform set_config('catalogo.reglas_planilla', '', true);

  -- Despublica por ausencia en el conjunto YA validado (misma transaccion).
  update productos set publicado = false where publicado and actualizado_en < v_ahora;
  get diagnostics v_ocultos = row_count;

  -- [AUDITORIA H06] _sincronizado_en: fecha de la ultima sincronizacion
  -- EXITOSA. El sitio la usa como version y para avisar si los precios estan
  -- viejos (distinto de "cuando lo leyo el navegador").
  with nuevas as (
    select key as clave, value as valor
    from jsonb_each_text(j->'config')
    where key <> 'negocio_logo_url' and left(key, 1) <> '_'
    union all select '_categorias', coalesce((j->'categorias')::text, '[]')
    union all select '_marcas',     coalesce((j->'marcas')::text, '[]')
    union all select '_rubros',     coalesce((j->'rubros')::text, '[]')
    union all select '_sincronizado_en', to_jsonb(v_ahora)::text
  ), subir as (
    insert into config (clave, valor)
    select clave, coalesce(valor, '') from nuevas
    on conflict (clave) do update set valor = excluded.valor
    returning clave
  )
  delete from config where clave not in (select clave from nuevas);
  select count(*) into v_config from config;

  return jsonb_build_object('productos', v_unicos, 'ocultados', v_ocultos, 'config', v_config,
                            'contrato', v_contrato, 'reglas_caja', v_reglas_nuevas);
end;
$$;

-- ── DESCARGAR Y APLICAR (lo que corre el cron) ──────────────────────
create or replace function public.sincronizar_catalogo()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url constant text := 'https://script.google.com/macros/s/AKfycbzgSbKJJOA_dcsaAILAVCjDZFdNyE4w5IKIiZIDeXW7jRwqsujEw-9p9BRzzv71CjCraA/exec?action=catalog';
  r          extensions.http_response;
  j          jsonb;
  v_resumen  jsonb;
begin
  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '50');
    r := extensions.http_get(v_url);
    if r.status <> 200 then
      raise exception 'Apps Script respondio %', r.status;
    end if;

    begin
      j := r.content::jsonb;
    exception when others then
      raise exception 'Apps Script no devolvio un JSON valido';
    end;

    -- Si aplicar_catalogo lanza un error, el bloque se revierte entero: no
    -- queda ningun producto a medio actualizar.
    v_resumen := public.aplicar_catalogo(j);
    insert into sincronizacion_log (ok, detalle) values (true, v_resumen::text);
    return v_resumen;
  exception when others then
    insert into sincronizacion_log (ok, detalle) values (false, left(sqlerrm, 500));
    return jsonb_build_object('error', left(sqlerrm, 500));
  end;
end;
$$;

-- [AUDITORIA H06] Para monitorear: cuanto hace de la ultima sincronizacion
-- buena y cuantas fallaron seguidas. Solo lo ve quien entra al SQL Editor.
create or replace view public.estado_sincronizacion with (security_invoker = true) as
select
  (select max(creado_en) from sincronizacion_log where ok)                       as ultima_ok,
  now() - (select max(creado_en) from sincronizacion_log where ok)               as antiguedad,
  (select count(*) from sincronizacion_log
    where not ok and creado_en > coalesce((select max(creado_en) from sincronizacion_log where ok), '-infinity')) as fallas_seguidas;
revoke all on public.estado_sincronizacion from anon, authenticated;

-- Solo la tarea programada la ejecuta: la clave publica no puede.
revoke all on function public.sincronizar_catalogo() from public, anon, authenticated;
revoke all on function public.aplicar_catalogo(jsonb) from public, anon, authenticated;
-- La funcion del trigger tampoco tiene que quedar expuesta en /rest/v1/rpc.
revoke all on function public.productos_marcar_solo_caja() from public, anon, authenticated;

-- Cada 10 minutos. Si la tarea ya existe se reemplaza (no se duplica).
select cron.unschedule(jobid) from cron.job where jobname = 'sincronizar-catalogo';
select cron.schedule('sincronizar-catalogo', '*/10 * * * *', $cron$select public.sincronizar_catalogo()$cron$);

-- Para correrla ahora:   select public.sincronizar_catalogo();
-- Para ver como viene:   select * from sincronizacion_log order by id desc limit 10;
-- Para pausarla:         select cron.unschedule('sincronizar-catalogo');
