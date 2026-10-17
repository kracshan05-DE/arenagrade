-- ArenaGrade production-readiness: shared foundations.
-- Review against supabase/discovery output before applying. Apply to a
-- non-production project first.
--
-- Conventions for every function in these migrations:
--   * SECURITY DEFINER only where the caller must not hold the privilege itself
--   * SET search_path = '' and fully qualified names (prevents search-path hijack)
--   * EXECUTE revoked from PUBLIC/anon and granted to the narrowest role
--   * Errors raised as short machine codes (e.g. 'slot_unavailable') that the
--     app maps to friendly text

create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Admin check (replaces any existing definition with identical semantics:
-- the caller's profile row has role = 'super_admin').
-- ---------------------------------------------------------------------------
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role::text = 'super_admin'
  )
$$;
revoke all on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Time helpers. The business timezone is Asia/Colombo (UTC+05:30, no DST).
-- Slots store a local date + local times; these helpers turn them into
-- comparable ranges.
-- ---------------------------------------------------------------------------
create or replace function public.slot_period(p_date date, p_start time, p_end time)
returns tsrange
language sql
immutable
parallel safe
as $$
  -- An end time at or before the start (e.g. 23:00-00:00) ends the next day.
  select tsrange(
    p_date + p_start,
    p_date + p_end + case when p_end <= p_start then interval '1 day' else interval '0' end,
    '[)'
  )
$$;

-- Which part of a court a slot occupies: half A = [1,2), half B = [2,3),
-- full court (and any unknown type, to fail safe) = [1,3). Two slots conflict
-- when both their times and their parts overlap.
create or replace function public.slot_parts(p_court_type text)
returns int4range
language sql
immutable
parallel safe
as $$
  select case p_court_type
    when 'half_a' then int4range(1, 2)
    when 'half_b' then int4range(2, 3)
    else int4range(1, 3)
  end
$$;

create or replace function public.colombo_now()
returns timestamp
language sql
stable
as $$ select (now() at time zone 'Asia/Colombo') $$;

-- ---------------------------------------------------------------------------
-- Audit log: who changed what. Written only by SECURITY DEFINER functions.
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_kind text not null default 'user' check (actor_kind in ('user', 'admin', 'system', 'provider')),
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_created_at_idx on public.audit_log (created_at);
create index if not exists audit_log_entity_idx on public.audit_log (entity_type, entity_id);

create or replace function public.write_audit(
  p_actor_id uuid, p_actor_kind text, p_action text, p_entity_type text, p_entity_id text, p_details jsonb
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, actor_kind, action, entity_type, entity_id, details)
  values (p_actor_id, p_actor_kind, p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb))
$$;
revoke all on function public.write_audit(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.write_audit(uuid, text, text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Operational events / incidents (failures, anomalies, security signals).
-- ---------------------------------------------------------------------------
create table if not exists public.app_events (
  id bigint generated always as identity primary key,
  severity text not null check (severity in ('info', 'warning', 'error', 'critical')),
  category text not null,
  event text not null,
  correlation_id text,
  details jsonb not null default '{}'::jsonb,
  requires_action boolean not null default false,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists app_events_created_at_idx on public.app_events (created_at);
create index if not exists app_events_unresolved_idx on public.app_events (severity) where requires_action and resolved_at is null;

create or replace function public.record_app_event(
  p_severity text, p_category text, p_event text, p_correlation_id text, p_details jsonb, p_requires_action boolean
) returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.app_events (severity, category, event, correlation_id, details, requires_action)
  values (p_severity, p_category, p_event, p_correlation_id, coalesce(p_details, '{}'::jsonb), coalesce(p_requires_action, false))
  returning id
$$;
revoke all on function public.record_app_event(text, text, text, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.record_app_event(text, text, text, text, jsonb, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Fixed-window rate limiter shared by all server instances.
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

create or replace function public.rate_limit_hit(p_key text, p_window_seconds integer, p_max integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;

  return jsonb_build_object(
    'allowed', v_hits <= p_max,
    'hits', v_hits,
    'retry_after_seconds', case when v_hits <= p_max then 0
      else ceil(extract(epoch from (v_window + make_interval(secs => p_window_seconds)) - now()))::int end
  );
end $$;
revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Harden the existing signup trigger (production: SECURITY DEFINER without a
-- fixed search_path, executable by API roles). Its body already uses the fully
-- qualified public.profiles, so pinning search_path does not change behaviour.
-- ---------------------------------------------------------------------------
alter function public.handle_new_user() set search_path = '';
revoke all on function public.handle_new_user() from public, anon, authenticated;
