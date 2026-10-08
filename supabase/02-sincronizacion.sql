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
--
--  Requiere las extensiones http y pg_cron. Se corre una sola vez, en el
--  SQL Editor, despues de 01-catalogo.sql.
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

-- Unidades por caja escritas en la presentacion ("caja de 12 unidades"), para
-- los productos que no tienen el dato cargado. 0 si no dice nada.
create or replace function public.caja_de_presentacion(p text) returns int
language sql immutable as $$
  select coalesce(
    (select (m)[1]::int from regexp_matches(coalesce(p, ''), 'caja de (\d{1,4}) unidades?', 'i') m limit 1),
    (select (m)[1]::int * (m)[2]::int from regexp_matches(coalesce(p, ''), '(\d{1,3}) unidades por bl[ií]ster y (\d{1,3}) bl[ií]steres por caja', 'i') m limit 1),
    0)
$$;

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
  v_n        int;
  v_pub      int;
  v_ahora    timestamptz := now();
  v_ocultos  int := 0;
  v_config   int := 0;
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

    if coalesce(j->>'ok', '') <> 'true'
       or jsonb_typeof(j->'productos') <> 'array'
       or jsonb_typeof(j->'config') <> 'object' then
      raise exception 'La respuesta del catalogo no tiene el formato esperado';
    end if;

    v_n := jsonb_array_length(j->'productos');
    select count(*) into v_pub from productos where publicado;
    if v_n < 1 or (v_pub > 0 and v_n < v_pub * 0.5) then
      raise exception 'El catalogo llego con % productos y hay % publicados: no se sincroniza', v_n, v_pub;
    end if;

    insert into productos (id, sku, nombre, descripcion, categoria, marca, precio, moneda,
                           unidades_caja, presentacion, unidad_precio, imagenes, rubros,
                           destacado, nuevo, sin_stock, posicion, orden, publicado, actualizado_en)
    select p->>'id',
           coalesce(p->>'sku', ''),
           coalesce(p->>'nombre', ''),
           coalesce(p->>'descripcion', ''),
           coalesce(p->>'categoria', ''),
           coalesce(p->>'marca', ''),
           nullif(p->>'precio', '')::numeric,
           coalesce(nullif(p->>'moneda', ''), 'ARS'),
           case when coalesce(nullif(p->>'unidadesCaja', '')::int, 0) > 0
                then (p->>'unidadesCaja')::int
                else public.caja_de_presentacion(p->>'presentacion') end,
           coalesce(p->>'presentacion', ''),
           case when p->>'unidadPrecio' in ('kg', 'unidad', 'caja') then p->>'unidadPrecio' else '' end,
           case when jsonb_typeof(p->'imagenes') = 'array'
                then coalesce((select array_agg(x) from jsonb_array_elements_text(p->'imagenes') x), '{}'::text[])
                else '{}'::text[] end,
           case when jsonb_typeof(p->'rubros') = 'array'
                then coalesce((select array_agg(x) from jsonb_array_elements_text(p->'rubros') x), '{}'::text[])
                else '{}'::text[] end,
           coalesce((p->>'destacado')::boolean, false),
           coalesce((p->>'nuevo')::boolean, false),
           coalesce((p->>'sinStock')::boolean, false),
           (t.i - 1)::int,
           coalesce(nullif(p->>'orden', '')::int, 0),
           true,
           v_ahora
    from jsonb_array_elements(j->'productos') with ordinality as t(p, i)
    where coalesce(p->>'id', '') <> ''
    on conflict (id) do update set
      sku = excluded.sku, nombre = excluded.nombre, descripcion = excluded.descripcion,
      categoria = excluded.categoria, marca = excluded.marca, precio = excluded.precio,
      moneda = excluded.moneda, unidades_caja = excluded.unidades_caja,
      presentacion = excluded.presentacion, unidad_precio = excluded.unidad_precio, imagenes = excluded.imagenes, rubros = excluded.rubros,
      destacado = excluded.destacado, nuevo = excluded.nuevo, sin_stock = excluded.sin_stock,
      posicion = excluded.posicion, orden = excluded.orden, publicado = true,
      actualizado_en = excluded.actualizado_en;

    update productos set publicado = false where publicado and actualizado_en < v_ahora;
    get diagnostics v_ocultos = row_count;

    with nuevas as (
      select key as clave, value as valor
      from jsonb_each_text(j->'config')
      where key <> 'negocio_logo_url'
      union all select '_categorias', coalesce((j->'categorias')::text, '[]')
      union all select '_marcas',     coalesce((j->'marcas')::text, '[]')
      union all select '_rubros',     coalesce((j->'rubros')::text, '[]')
    ), subir as (
      insert into config (clave, valor)
      select clave, coalesce(valor, '') from nuevas
      on conflict (clave) do update set valor = excluded.valor
      returning clave
    )
    delete from config where clave not in (select clave from nuevas);
    select count(*) into v_config from config;

    v_resumen := jsonb_build_object('productos', v_n, 'ocultados', v_ocultos, 'config', v_config);
    insert into sincronizacion_log (ok, detalle) values (true, v_resumen::text);
    return v_resumen;
  exception when others then
    insert into sincronizacion_log (ok, detalle) values (false, left(sqlerrm, 500));
    return jsonb_build_object('error', left(sqlerrm, 500));
  end;
end;
$$;

-- Solo la tarea programada la ejecuta: la clave publica no puede.
revoke all on function public.sincronizar_catalogo() from public, anon, authenticated;

-- Cada 10 minutos.
select cron.schedule('sincronizar-catalogo', '*/10 * * * *', $cron$select public.sincronizar_catalogo()$cron$);

-- Para correrla ahora:   select public.sincronizar_catalogo();
-- Para ver como viene:   select * from sincronizacion_log order by id desc limit 10;
-- Para pausarla:         select cron.unschedule('sincronizar-catalogo');
