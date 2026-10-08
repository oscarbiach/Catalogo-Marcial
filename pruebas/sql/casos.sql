-- Casos de regresion de la base (auditoria H04, H07, H09, H02, H03).
-- Corre todo dentro de una transaccion y la deshace al final: no deja datos.
-- NO correr en produccion: usar una rama de Supabase o el Postgres local
-- (pruebas/sql/correr-local.sh). Cada caso imprime "ok" o corta con error.
\set ON_ERROR_STOP 1
begin;

create function pg_temp.debe_fallar(sql text, patron text) returns text language plpgsql as $$
begin
  execute sql;
  raise exception 'Se esperaba un error que contenga "%"', patron;
exception when others then
  if sqlerrm not like '%' || patron || '%' then raise; end if;
  return 'ok';
end $$;

insert into caja_cerrada values ('105', 20) on conflict do nothing;
insert into caja_cerrada_kg values ('200', 1.25) on conflict do nothing;

select 'sync valido', public.aplicar_catalogo('{"ok":true,"config":{"whatsapp":"1","pedidos_activos":"si"},"productos":[
 {"id":"105","nombre":"Pan","precio":1624,"unidadPrecio":"unidad"},
 {"id":"200","nombre":"Cremoso","precio":0.10,"unidadPrecio":"kg"},
 {"id":"300","nombre":"Mayonesa","precio":500},
 {"id":"400","nombre":"Sin stock","precio":10,"sinStock":true},
 {"id":"","nombre":"renglon en blanco"}]}'::jsonb) ->> 'productos' = '4' as ok;

-- H04: respuestas defectuosas no despublican nada
select 'H04 sin productos',  pg_temp.debe_fallar($$select public.aplicar_catalogo('{"ok":true,"config":{}}')$$, 'Contrato');
select 'H04 productos {}',   pg_temp.debe_fallar($$select public.aplicar_catalogo('{"ok":true,"config":{},"productos":{}}')$$, 'Contrato');
select 'H04 ids vacios',     pg_temp.debe_fallar($$select public.aplicar_catalogo('{"ok":true,"config":{},"productos":[{"id":"1","nombre":"a"},{"id":""},{"id":""},{"id":""},{"id":""}]}')$$, 'no se sincroniza');
select 'H04 precio basura',  pg_temp.debe_fallar($$select public.aplicar_catalogo('{"ok":true,"config":{},"productos":[{"id":"105","nombre":"a","precio":"12,5"},{"id":"200","nombre":"b"},{"id":"300","nombre":"c"},{"id":"400","nombre":"d"}]}')$$, 'datos invalidos');
select 'H04 ids repetidos',  pg_temp.debe_fallar($$select public.aplicar_catalogo('{"ok":true,"config":{},"productos":[{"id":"105","nombre":"a"},{"id":"105","nombre":"b"},{"id":"300","nombre":"c"},{"id":"400","nombre":"d"}]}')$$, 'repetidos');
select 'H04 siguen publicados', (select count(*) from productos where publicado and id in ('105','200','300','400')) = 4 as ok;

-- H01 contrato 2: la planilla manda sobre la venta por caja cerrada
savepoint antes_contrato;
select 'H01 contrato 2 aplica reglas', public.aplicar_catalogo('{"ok":true,"contrato":2,"config":{"whatsapp":"1","pedidos_activos":"si"},"productos":[
 {"id":"105","nombre":"Pan","precio":1624,"unidadPrecio":"unidad","unidadesCaja":20,"soloCaja":true,"kgCaja":0},
 {"id":"200","nombre":"Cremoso","precio":0.10,"unidadPrecio":"kg","soloCaja":true,"kgCaja":1.25},
 {"id":"300","nombre":"Mayonesa","precio":500,"unidadPrecio":"unidad","unidadesCaja":12,"soloCaja":true,"kgCaja":0},
 {"id":"400","nombre":"Sin stock","precio":10,"sinStock":true,"soloCaja":false,"kgCaja":0}]}'::jsonb) ->> 'reglas_caja' = '3' as ok;
select 'H01 300 pasa a caja (no esta en las listas)', (select solo_caja and unidades_caja = 12 from productos where id = '300') as ok;
select 'H01 kg de la planilla', (select solo_caja and kg_caja = 1.25 from productos where id = '200') as ok;
select 'H01 listas intactas', (select count(*) from caja_cerrada) = 1 and (select count(*) from caja_cerrada_kg) = 1 as ok;
select 'H01 total con regla de planilla', (public.registrar_pedido(gen_random_uuid(), '', '', '[{"id":"300","cantidad":2}]') ->> 'total')::numeric = 12000 as ok;
select 'H01 red de seguridad', pg_temp.debe_fallar($$select public.aplicar_catalogo('{"ok":true,"contrato":2,"config":{},"productos":[
 {"id":"105","nombre":"Pan","soloCaja":false},{"id":"200","nombre":"b"},{"id":"300","nombre":"c"},{"id":"400","nombre":"d"}]}')$$, 'bajarian de 3 a 0');
select 'H01 kgCaja invalido', pg_temp.debe_fallar($$select public.aplicar_catalogo('{"ok":true,"contrato":2,"config":{},"productos":[
 {"id":"105","nombre":"a","kgCaja":"3,6"},{"id":"200","nombre":"b"},{"id":"300","nombre":"c"},{"id":"400","nombre":"d"}]}')$$, 'datos invalidos');
-- Volver al contrato 1 (cc_desactivar): las listas vuelven a mandar
select 'H01 vuelta a contrato 1', public.aplicar_catalogo('{"ok":true,"config":{"whatsapp":"1","pedidos_activos":"si"},"productos":[
 {"id":"105","nombre":"Pan","precio":1624,"unidadPrecio":"unidad"},
 {"id":"200","nombre":"Cremoso","precio":0.10,"unidadPrecio":"kg"},
 {"id":"300","nombre":"Mayonesa","precio":500,"unidadPrecio":"unidad","soloCaja":true},
 {"id":"400","nombre":"Sin stock","precio":10,"sinStock":true}]}'::jsonb) ->> 'contrato' = '1' as ok;
-- En otra sentencia: la anterior ve la foto de antes de la llamada.
select 'H01 listas mandan otra vez', (select not solo_caja from productos where id = '300')
   and (select solo_caja from productos where id = '105') and (select kg_caja = 1.25 from productos where id = '200') as ok;
rollback to savepoint antes_contrato;

-- H02/H09: registro, idempotencia y redondeo de la caja por kilo
select 'H09 total servidor', (public.registrar_pedido('11111111-1111-1111-1111-111111111111', 'Cli', '',
  '[{"id":"105","cantidad":2},{"id":"200","cantidad":3}]') ->> 'total')::numeric = 64960.39 as ok;
select 'H02 reintento', (public.registrar_pedido('11111111-1111-1111-1111-111111111111', 'Cli', '',
  '[{"id":"105","cantidad":2}]') ->> 'duplicado')::boolean as ok;
select 'H02 sin duplicar', (select count(*) from pedidos_catalogo where ref = '11111111-1111-1111-1111-111111111111') = 1 as ok;

-- H07: validacion estricta
select 'H07 cantidad 0',     pg_temp.debe_fallar($$select public.registrar_pedido(gen_random_uuid(),'','','[{"id":"105","cantidad":0}]')$$, 'cantidades invalidas');
select 'H07 cantidad texto', pg_temp.debe_fallar($$select public.registrar_pedido(gen_random_uuid(),'','','[{"id":"105","cantidad":"2"}]')$$, 'cantidades invalidas');
select 'H07 sin stock',      pg_temp.debe_fallar($$select public.registrar_pedido(gen_random_uuid(),'','','[{"id":"400","cantidad":1}]')$$, 'no estan disponibles');
select 'H07 inexistente',    pg_temp.debe_fallar($$select public.registrar_pedido(gen_random_uuid(),'','','[{"id":"zzz","cantidad":1},{"id":"105","cantidad":1}]')$$, 'no estan disponibles');
select 'H07 repetido',       pg_temp.debe_fallar($$select public.registrar_pedido(gen_random_uuid(),'','','[{"id":"105","cantidad":1},{"id":"105","cantidad":1}]')$$, 'mas de una vez');
select 'H08 101 lineas',     pg_temp.debe_fallar($$select public.registrar_pedido(gen_random_uuid(),'','',(select jsonb_agg(jsonb_build_object('id','105','cantidad',1)) from generate_series(1,101)))$$, 'entre 1 y 100');
update config set valor = 'no' where clave = 'pedidos_activos';
select 'H07 pedidos cerrados', pg_temp.debe_fallar($$select public.registrar_pedido(gen_random_uuid(),'','','[{"id":"105","cantidad":1}]')$$, 'no estamos tomando');
update config set valor = 'si' where clave = 'pedidos_activos';

-- H03: limite por IP (5 cada 10 minutos)
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.9, 10.0.0.1"}', true);
select 'H03 rafaga', count(public.registrar_pedido(gen_random_uuid(), '', '', '[{"id":"300","cantidad":1}]')) = 5 as ok from generate_series(1, 5);
select 'H03 sexto', pg_temp.debe_fallar($$select public.registrar_pedido(gen_random_uuid(),'','','[{"id":"300","cantidad":1}]')$$, 'muchos pedidos');

rollback;
