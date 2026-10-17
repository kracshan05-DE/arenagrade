-- ArenaGrade schema discovery — READ ONLY.
-- Run in the Supabase SQL editor (ideally on a non-production copy; it is safe on
-- production because it reads catalog metadata only and returns no customer data).
-- It returns ONE row with ONE JSON column. Copy that JSON value and save it as
-- supabase/discovery/output/01_schema_metadata.json (or attach it in chat).

with
tbls as (
  select c.oid, c.relname, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
),
cols as (
  select table_name, jsonb_agg(jsonb_build_object(
           'column', column_name,
           'type', case when data_type = 'USER-DEFINED' then udt_name else data_type end,
           'nullable', is_nullable,
           'default', column_default,
           'generated', is_generated
         ) order by ordinal_position) as columns
  from information_schema.columns
  where table_schema = 'public'
  group by table_name
),
cons as (
  select conrelid::regclass::text as table_name,
         jsonb_agg(jsonb_build_object('name', conname, 'type', contype,
                   'definition', pg_get_constraintdef(oid)) order by conname) as constraints
  from pg_constraint
  where connamespace = 'public'::regnamespace
  group by conrelid
),
idx as (
  select tablename as table_name,
         jsonb_agg(jsonb_build_object('name', indexname, 'definition', indexdef) order by indexname) as indexes
  from pg_indexes where schemaname = 'public'
  group by tablename
),
trg as (
  select event_object_table as table_name,
         jsonb_agg(jsonb_build_object('name', trigger_name, 'timing', action_timing,
                   'event', event_manipulation, 'action', action_statement)) as triggers
  from information_schema.triggers where trigger_schema = 'public'
  group by event_object_table
),
pol as (
  select schemaname || '.' || tablename as table_name,
         jsonb_agg(jsonb_build_object('policy', policyname, 'command', cmd, 'roles', roles,
                   'permissive', permissive, 'using', qual, 'with_check', with_check)
                   order by policyname) as policies
  from pg_policies
  where schemaname in ('public', 'storage')
  group by schemaname, tablename
),
grants as (
  select table_name,
         jsonb_agg(distinct grantee || ':' || privilege_type) as grants
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
  group by table_name
),
col_grants as (
  select table_name,
         jsonb_agg(distinct grantee || ':' || privilege_type || ':' || column_name) as column_grants
  from information_schema.column_privileges
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
  group by table_name
),
funcs as (
  select jsonb_agg(jsonb_build_object(
           'name', p.proname,
           'args', pg_get_function_identity_arguments(p.oid),
           'returns', pg_get_function_result(p.oid),
           'security_definer', p.prosecdef,
           'config', p.proconfig,
           'acl', p.proacl::text,
           'definition', pg_get_functiondef(p.oid)
         ) order by p.proname) as functions
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
),
enums as (
  select jsonb_object_agg(t.typname, labels) as enums
  from (select t.typname, jsonb_agg(e.enumlabel order by e.enumsortorder) as labels
        from pg_type t join pg_enum e on e.enumtypid = t.oid
        join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public' group by t.typname) t
),
exts as (
  select jsonb_agg(jsonb_build_object('name', extname, 'version', extversion, 'schema', extnamespace::regnamespace::text)) as extensions
  from pg_extension
),
buckets as (
  select jsonb_agg(jsonb_build_object('id', id, 'public', public,
         'file_size_limit', file_size_limit, 'allowed_mime_types', allowed_mime_types)) as buckets
  from storage.buckets
)
select jsonb_pretty(jsonb_build_object(
  'generated_at', now(),
  'server_version', current_setting('server_version'),
  'db_timezone', current_setting('TimeZone'),
  'tables', (select jsonb_object_agg(t.relname, jsonb_build_object(
                'rls_enabled', t.rls_enabled, 'rls_forced', t.rls_forced,
                'columns', c.columns, 'constraints', k.constraints, 'indexes', i.indexes,
                'triggers', tr.triggers, 'grants', g.grants, 'column_grants', cg.column_grants))
             from tbls t
             left join cols c on c.table_name = t.relname
             left join cons k on k.table_name in (t.relname, 'public.' || t.relname)
             left join idx i on i.table_name = t.relname
             left join trg tr on tr.table_name = t.relname
             left join grants g on g.table_name = t.relname
             left join col_grants cg on cg.table_name = t.relname),
  'policies', (select jsonb_object_agg(table_name, policies) from pol),
  'functions', (select functions from funcs),
  'enums', (select enums from enums),
  'extensions', (select extensions from exts),
  'storage_buckets', (select buckets from buckets)
)) as schema_metadata;
