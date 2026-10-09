-- Solo para un Postgres LOCAL de prueba (no Supabase): imita lo minimo de
-- Supabase (roles anon/authenticated) y de las extensiones http y pg_cron,
-- para poder correr 01, 02 y 03 sin red. La "respuesta" de Apps Script se
-- carga en extensions._respuesta.
create role anon;
create role authenticated;
create role service_role;
create schema extensions;
create type extensions.http_response as (status int, content_type text, headers text, content text);
create table extensions._respuesta (contenido text);
create function extensions.http_set_curlopt(a text, b text) returns boolean language sql as 'select true';
create function extensions.http_get(u text) returns extensions.http_response language sql as
  $$ select (200, '', '', (select contenido from extensions._respuesta limit 1))::extensions.http_response $$;
create schema cron;
create table cron.job (jobid serial, jobname text);
create function cron.schedule(n text, s text, c text) returns int language sql as
  $$ insert into cron.job (jobname) values (n) returning jobid $$;
create function cron.unschedule(i int) returns boolean language sql as
  $$ delete from cron.job where jobid = i returning true $$;
