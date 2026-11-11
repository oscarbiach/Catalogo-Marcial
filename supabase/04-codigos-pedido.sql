-- ===================================================================
--  CODIGOS DE DESCUENTO Y REFERENCIA DEL CATALOGO
--
--  Correr despues de 03-pedidos.sql y antes de publicar el app.js que
--  envia p_codigo. Es idempotente: no borra pedidos ni codigos existentes.
--
--  Los codigos los valida la base. La lista que aparece en config.js solo
--  mejora la experiencia visual; nunca decide un descuento por si sola.
-- ===================================================================

alter table pedidos_catalogo add column if not exists codigo_promocional text;
alter table pedidos_catalogo add column if not exists referencia_promocional text;
alter table pedidos_catalogo add column if not exists descuento_porcentaje numeric(5,2) not null default 0;
alter table pedidos_catalogo add column if not exists descuento_importe numeric(14,2) not null default 0;
alter table pedidos_catalogo add column if not exists total_con_descuento numeric(14,2);

create table if not exists codigos_pedido (
  codigo text primary key check (codigo = upper(codigo) and codigo ~ '^[A-Z0-9_-]{1,32}$'),
  activo boolean not null default true,
  tipo text not null check (tipo in ('referencia', 'descuento')),
  referencia text not null default '',
  descuento_porcentaje numeric(5,2) not null default 0 check (descuento_porcentaje between 0 and 100),
  creado_en timestamptz not null default now(),
  check ((tipo = 'referencia' and descuento_porcentaje = 0) or tipo = 'descuento')
);

alter table codigos_pedido enable row level security;
revoke all on codigos_pedido from public, anon, authenticated;

-- Alta inicial. "on conflict do nothing" deja intactos futuros cambios del
-- negocio hechos en el panel SQL.
insert into codigos_pedido (codigo, tipo, referencia, descuento_porcentaje) values
  ('ARC1', 'referencia', 'Referido por Angel', 0),
  ('CYBERMARCIAL', 'descuento', '10% de descuento', 10)
on conflict (codigo) do nothing;

-- Una envoltura de la validacion de pedidos existente: primero verifica el
-- codigo en el servidor, despues registra con los precios reales y finalmente
-- guarda el beneficio aplicado. El importe del navegador nunca se acepta.
create or replace function public.registrar_pedido_con_codigo(
  p_ip text, p_ref uuid, p_cliente text, p_nota text, p_codigo text, p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigo text := upper(regexp_replace(coalesce(p_codigo, ''), '\s+', '', 'g'));
  v_regla codigos_pedido%rowtype;
  v_resultado jsonb;
  v_pedido pedidos_catalogo%rowtype;
  v_total numeric(14,2);
  v_descuento numeric(14,2) := 0;
  v_total_final numeric(14,2);
begin
  -- La idempotencia prevalece: si la referencia ya fue registrada, se devuelve
  -- exactamente el beneficio original aunque el cliente vuelva a tocar el UI.
  select * into v_pedido from pedidos_catalogo where ref = p_ref;
  if found then
    v_resultado := public._registrar_pedido(p_ip, p_ref, p_cliente, p_nota, p_items);
    return v_resultado || jsonb_build_object(
      'codigo', v_pedido.codigo_promocional,
      'referencia_promocional', v_pedido.referencia_promocional,
      'descuento_porcentaje', v_pedido.descuento_porcentaje,
      'descuento_importe', v_pedido.descuento_importe,
      'total_con_descuento', coalesce(v_pedido.total_con_descuento, v_pedido.total_estimado));
  end if;

  if v_codigo <> '' then
    if length(v_codigo) > 32 or v_codigo !~ '^[A-Z0-9_-]+$' then
      raise exception using errcode = 'P0001', hint = 'codigo_invalido',
        message = 'El codigo ingresado no es valido.';
    end if;
    select * into v_regla from codigos_pedido where codigo = v_codigo and activo;
    if not found then
      raise exception using errcode = 'P0001', hint = 'codigo_invalido',
        message = 'El codigo ingresado no esta vigente.';
    end if;
  end if;

  v_resultado := public._registrar_pedido(p_ip, p_ref, p_cliente, p_nota, p_items);
  select * into v_pedido from pedidos_catalogo where id = (v_resultado->>'id')::uuid;
  v_total := v_pedido.total_estimado;

  if v_codigo <> '' and v_regla.tipo = 'descuento' then
    v_descuento := round(v_total * v_regla.descuento_porcentaje / 100, 2);
  end if;
  v_total_final := v_total - v_descuento;

  update pedidos_catalogo
  set codigo_promocional = nullif(v_codigo, ''),
      referencia_promocional = case when v_codigo = '' then null else v_regla.referencia end,
      descuento_porcentaje = case when v_codigo = '' then 0 else v_regla.descuento_porcentaje end,
      descuento_importe = v_descuento,
      total_con_descuento = v_total_final
  where id = v_pedido.id;

  return v_resultado || jsonb_build_object(
    'codigo', nullif(v_codigo, ''),
    'referencia_promocional', case when v_codigo = '' then null else v_regla.referencia end,
    'descuento_porcentaje', case when v_codigo = '' then 0 else v_regla.descuento_porcentaje end,
    'descuento_importe', v_descuento,
    'total_con_descuento', v_total_final);
end;
$$;

revoke all on function public.registrar_pedido_con_codigo(text, uuid, text, text, text, jsonb) from public, anon, authenticated;

-- Puerta directa del sitio (sin Turnstile).
create or replace function public.registrar_pedido(
  p_ref uuid, p_cliente text, p_nota text, p_items jsonb, p_codigo text default null
)
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
  return public.registrar_pedido_con_codigo(
    coalesce(nullif(btrim(v_headers->>'cf-connecting-ip'), ''),
             nullif(btrim(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1)), '')),
    p_ref, p_cliente, p_nota, p_codigo, p_items);
end;
$$;

revoke all on function public.registrar_pedido(uuid, text, text, jsonb, text) from public, authenticated;
grant execute on function public.registrar_pedido(uuid, text, text, jsonb, text) to anon;

-- Puerta que usa la Edge Function cuando Turnstile esta encendido.
create or replace function public.registrar_pedido_verificado(
  p_ip text, p_ref uuid, p_cliente text, p_nota text, p_items jsonb, p_codigo text default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.registrar_pedido_con_codigo(p_ip, p_ref, p_cliente, p_nota, p_codigo, p_items);
$$;

revoke all on function public.registrar_pedido_verificado(text, uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.registrar_pedido_verificado(text, uuid, text, text, jsonb, text) to service_role;

-- Administracion de campanas (cambiar solo estos datos; no editar la funcion):
-- update codigos_pedido set activo = false where codigo = 'CYBERMARCIAL';
-- insert into codigos_pedido (codigo, tipo, referencia, descuento_porcentaje)
-- values ('NUEVACAMPANA', 'descuento', '15% de descuento', 15);
