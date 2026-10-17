-- ArenaGrade: site-wide booking mode + admin test bookings (owner decision
-- 2026-10-18: until PayHere is approved, only admins may book; their bookings
-- are TEST bookings, deleted on 1 November).
--
--   booking_mode = 'admin_only' : only super_admins can hold slots or pay
--                  'public'     : everyone (after launch)
--                  'closed'     : nobody (emergency stop)
-- Enforced inside the database (hold + payment functions), so calling the API
-- directly cannot bypass it. Non-live payments (PayHere sandbox, simulator,
-- manual test confirmations) are allowed ONLY for super_admins, in every mode:
-- sandbox credentials left in production can never give customers free bookings.

create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.app_settings (key, value) values ('booking_mode', 'admin_only')
on conflict (key) do nothing;
alter table public.app_settings enable row level security;
revoke insert, update, delete, truncate on public.app_settings from anon, authenticated;
drop policy if exists app_settings_public_read on public.app_settings;
create policy app_settings_public_read on public.app_settings for select to anon, authenticated
  using (key in ('booking_mode'));

create or replace function public.booking_mode()
returns text
language sql
stable
security definer
set search_path = ''
as $$ select coalesce((select value from public.app_settings where key = 'booking_mode'), 'closed') $$;
revoke all on function public.booking_mode() from public, anon, authenticated;

create or replace function public._is_admin_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.profiles p where p.id = p_user_id and p.role::text = 'super_admin') $$;
revoke all on function public._is_admin_user(uuid) from public, anon, authenticated, service_role;

create or replace function public._assert_booking_allowed(p_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mode text := public.booking_mode();
begin
  if v_mode = 'public' then return; end if;
  if v_mode = 'admin_only' and public._is_admin_user(p_user_id) then return; end if;
  if v_mode = 'admin_only' then
    raise exception 'booking_admin_only' using errcode = 'P0001';
  end if;
  raise exception 'booking_closed' using errcode = 'P0001';
end $$;
revoke all on function public._assert_booking_allowed(uuid) from public, anon, authenticated, service_role;

create or replace function public.admin_set_booking_mode(p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text := public.booking_mode();
begin
  if not public.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_mode not in ('admin_only', 'public', 'closed') then
    raise exception 'invalid_mode' using errcode = '22023';
  end if;
  insert into public.app_settings (key, value, updated_at, updated_by) values ('booking_mode', p_mode, now(), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  perform public.write_audit(auth.uid(), 'admin', 'settings.booking_mode', 'app_settings', 'booking_mode',
                             jsonb_build_object('from', v_old, 'to', p_mode));
  return jsonb_build_object('booking_mode', p_mode, 'previous', v_old);
end $$;
revoke all on function public.admin_set_booking_mode(text) from public, anon;
grant execute on function public.admin_set_booking_mode(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Wrap the hold and payment functions with the mode/test-payment checks.
-- (The tested core functions are kept unchanged under new internal names.)
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public._hold_slots_core(uuid[])') is null then
    alter function public.hold_slots(uuid[]) rename to _hold_slots_core;
  end if;
  if to_regprocedure('public._payment_create_attempt_core(uuid, uuid, text, text, integer)') is null then
    alter function public.payment_create_attempt(uuid, uuid, text, text, integer) rename to _payment_create_attempt_core;
  end if;
end $$;
revoke all on function public._hold_slots_core(uuid[]) from public, anon, authenticated, service_role;
revoke all on function public._payment_create_attempt_core(uuid, uuid, text, text, integer) from public, anon, authenticated, service_role;

create or replace function public.hold_slots(p_slot_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  perform public._assert_booking_allowed(auth.uid());
  return public._hold_slots_core(p_slot_ids);
end $$;
revoke all on function public.hold_slots(uuid[]) from public, anon;
grant execute on function public.hold_slots(uuid[]) to authenticated;

create or replace function public.payment_create_attempt(
  p_user_id uuid, p_slot_id uuid, p_provider text, p_environment text, p_min_seconds_left integer default 60
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._assert_booking_allowed(p_user_id);
  if p_environment <> 'live' and not public._is_admin_user(p_user_id) then
    raise exception 'test_payments_admin_only' using errcode = 'P0001';
  end if;
  return public._payment_create_attempt_core(p_user_id, p_slot_id, p_provider, p_environment, p_min_seconds_left);
end $$;
revoke all on function public.payment_create_attempt(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.payment_create_attempt(uuid, uuid, text, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Admin TEST booking: confirm the admin's own current hold without payment.
-- Recorded as a payment attempt with provider 'manual', environment 'test'
-- (never counted as revenue) so 04_purge_test_bookings.sql can remove it.
-- ---------------------------------------------------------------------------
alter table public.payment_attempts drop constraint if exists payment_attempts_provider_check;
alter table public.payment_attempts add constraint payment_attempts_provider_check
  check (provider in ('payhere', 'simulator', 'manual'));

create or replace function public.admin_confirm_test_booking(p_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_first public.slots%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_total numeric;
  v_booking uuid;
begin
  if not public.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform 1 from public.slots s where s.id = p_slot_id for update;
  v_ids := public._hold_group(p_slot_id, v_uid);
  if cardinality(v_ids) = 0 then
    raise exception 'hold_invalid_or_expiring' using errcode = 'P0001';
  end if;
  perform 1 from public.slots s where s.id = any (v_ids) order by s.id for update;
  select * into v_first from public.slots s where s.id = v_ids[1];
  if v_first.lock_expires_at <= now() then
    raise exception 'hold_invalid_or_expiring' using errcode = 'P0001';
  end if;
  select sum(s.price_lkr) into v_total from public.slots s where s.id = any (v_ids);

  insert into public.payment_attempts (order_id, user_id, slot_id, slot_ids, court_id, amount_lkr, provider, environment, hold_expires_at, status)
  values ('AGTEST' || to_char(public.colombo_now(), 'YYMMDDHH24MISS') || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
          v_uid, v_ids[1], v_ids, v_first.court_id, greatest(v_total, 0.01), 'manual', 'test', v_first.lock_expires_at, 'initiated')
  returning * into v_attempt;

  v_booking := public._confirm_attempt_slots(v_attempt, null);
  if v_booking is null then
    raise exception 'hold_invalid_or_expiring' using errcode = 'P0001';
  end if;
  update public.payment_attempts
  set status = 'succeeded', booking_id = v_booking, confirmed_at = now(), updated_at = now(),
      reconciliation_note = 'Admin test booking (no payment)'
  where id = v_attempt.id;

  perform public.write_audit(v_uid, 'admin', 'booking.admin_test_confirmed', 'booking', v_booking::text,
    jsonb_build_object('order_id', v_attempt.order_id, 'slot_ids', to_jsonb(v_ids)));
  return jsonb_build_object('booking_id', v_booking, 'order_id', v_attempt.order_id, 'slot_ids', to_jsonb(v_ids));
end $$;
revoke all on function public.admin_confirm_test_booking(uuid) from public, anon;
grant execute on function public.admin_confirm_test_booking(uuid) to authenticated;
