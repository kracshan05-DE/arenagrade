-- ArenaGrade: multi-hour reservations (The Solo Court), court configuration,
-- hourly pricing and idempotent slot generation.
--
-- Design (2026-10-18):
--   * Every bookable hour stays one row in public.slots. A two-hour Solo Court
--     reservation is TWO consecutive slot rows held and booked together, so the
--     existing EXCLUDE constraint (per court, per court part, per time range)
--     keeps protecting every physical hour without new conflict logic.
--   * A hold "group" = the slots locked by one customer with the SAME
--     lock_expires_at (set once by the database for the whole group). One
--     10-minute timer covers the whole reservation; the existing pg_cron job and
--     every hold path release the group together because the expiry is shared.
--   * bookings keeps slot_id (first hour, for compatibility); booking_slots
--     links a booking to all of its hours. payment_attempts.slot_ids records
--     exactly which hours a payment is for.
--   * Courts are independent: conflicts are scoped by court_id. The Solo Court
--     is its own court row with has_half_court = false, so St. Mary's half-court
--     cut-off never applies to it.
--   * court_pricing.price_lkr is defined as the price PER HOUR. A slot's price is
--     hourly price x slot length in hours.

-- ---------------------------------------------------------------------------
-- Court configuration
-- ---------------------------------------------------------------------------
alter table public.courts add column if not exists max_consecutive_slots integer not null default 1;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'courts_max_consecutive_slots_check') then
    alter table public.courts add constraint courts_max_consecutive_slots_check check (max_consecutive_slots between 1 and 4);
  end if;
end $$;
comment on column public.courts.max_consecutive_slots is
  'How many consecutive slots one reservation may cover (The Solo Court: 2 = one or two hours).';
comment on column public.court_pricing.price_lkr is 'Price PER HOUR for applies_to during [time_from, time_to).';

-- ---------------------------------------------------------------------------
-- booking_slots: every hour a booking covers
-- ---------------------------------------------------------------------------
create table if not exists public.booking_slots (
  booking_id uuid not null references public.bookings(id) on delete cascade,
  slot_id uuid not null references public.slots(id),
  primary key (booking_id, slot_id)
);
create index if not exists booking_slots_slot_idx on public.booking_slots (slot_id);
insert into public.booking_slots (booking_id, slot_id)
select b.id, b.slot_id from public.bookings b
on conflict do nothing;
alter table public.booking_slots enable row level security;
revoke insert, update, delete, truncate on public.booking_slots from anon, authenticated;
drop policy if exists booking_slots_read_own_or_admin on public.booking_slots;
create policy booking_slots_read_own_or_admin on public.booking_slots for select to authenticated
  using ((select public.is_super_admin())
         or exists (select 1 from public.bookings b where b.id = booking_slots.booking_id and b.user_id = (select auth.uid())));

alter table public.payment_attempts add column if not exists slot_ids uuid[];
update public.payment_attempts set slot_ids = array[slot_id] where slot_ids is null;
alter table public.payment_attempts alter column slot_ids set not null;

-- ---------------------------------------------------------------------------
-- Pricing helpers
-- ---------------------------------------------------------------------------
create or replace function public.court_hourly_price(p_court_id uuid, p_court_type text, p_start time)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select p.price_lkr
  from public.court_pricing p
  where p.court_id = p_court_id and p.applies_to::text = p_court_type
    and p.time_from <= p_start
    and (p.time_to > p_start or p.time_to <= p.time_from)   -- time_to <= time_from: runs to midnight
  order by p.time_from desc
  limit 1
$$;
revoke all on function public.court_hourly_price(uuid, text, time) from public, anon, authenticated;

create or replace function public.slot_hours(p_start time, p_end time)
returns numeric
language sql
immutable
as $$
  select extract(epoch from (upper(public.slot_period(date '2000-01-01', p_start, p_end))
                              - lower(public.slot_period(date '2000-01-01', p_start, p_end)))) / 3600.0
$$;

-- ---------------------------------------------------------------------------
-- Internal: the hold group a slot belongs to (same owner, same expiry).
-- ---------------------------------------------------------------------------
create or replace function public._hold_group(p_slot_id uuid, p_user_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(g.id order by g.slot_date, g.start_time), '{}')
  from public.slots s
  join public.slots g on g.locked_by = s.locked_by and g.lock_expires_at = s.lock_expires_at
                     and g.status::text = 'locked' and g.court_id = s.court_id
  where s.id = p_slot_id and s.locked_by = p_user_id and s.status::text = 'locked'
$$;
revoke all on function public._hold_group(uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Customer: hold one slot, or 2+ CONSECUTIVE slots of the same court/type, as
-- ONE reservation with ONE expiry. All-or-nothing: if any hour fails a rule,
-- the transaction raises and nothing is held.
-- Extra errors vs hold_slot: invalid_selection, slots_not_consecutive,
--   too_many_consecutive_slots
-- ---------------------------------------------------------------------------
create or replace function public.hold_slots(p_slot_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_n integer := coalesce(cardinality(p_slot_ids), 0);
  v_slots public.slots[];
  v_first public.slots%rowtype;
  v_last public.slots%rowtype;
  v_court public.courts%rowtype;
  v_ids uuid[];
  s public.slots%rowtype;
  v_prev public.slots%rowtype;
  i integer;
  v_expires timestamptz;
  v_groups integer;
  v_total numeric := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if v_n < 1 or v_n > 4 or (select count(distinct x) from unnest(p_slot_ids) x) <> v_n then
    raise exception 'invalid_selection' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hold_user:' || v_uid::text, 0));

  select array_agg(x order by x.slot_date, x.start_time) into v_slots
  from public.slots x where x.id = any (p_slot_ids);
  if coalesce(cardinality(v_slots), 0) <> v_n then
    raise exception 'slot_not_found' using errcode = 'P0002';
  end if;
  v_first := v_slots[1];
  v_last := v_slots[v_n];

  -- Same court, same court type, same date, each hour starting when the previous ends.
  for i in 2..v_n loop
    s := v_slots[i];
    v_prev := v_slots[i - 1];
    if s.court_id <> v_first.court_id or s.court_type::text <> v_first.court_type::text
       or s.slot_date <> v_prev.slot_date or s.start_time <> v_prev.end_time then
      raise exception 'slots_not_consecutive' using errcode = 'P0001';
    end if;
  end loop;

  select * into v_court from public.courts c where c.id = v_first.court_id;
  if not found or not coalesce(v_court.is_active, false) then
    raise exception 'court_unavailable' using errcode = 'P0001';
  end if;
  if v_n > coalesce(v_court.max_consecutive_slots, 1) then
    raise exception 'too_many_consecutive_slots' using errcode = 'P0001';
  end if;

  -- Lock every slot that could conflict with the whole range, in id order.
  perform public._lock_slot_neighbourhood(v_first.court_id, v_first.slot_date, v_first.start_time, v_last.end_time, v_first.court_type::text);

  select array_agg(x order by x.slot_date, x.start_time) into v_slots
  from public.slots x where x.id = any (p_slot_ids);
  v_ids := array(select (u).id from unnest(v_slots) u);

  -- Retry / second tab: the same customer already holds exactly this group.
  if (select bool_and((u).status::text = 'locked' and (u).locked_by = v_uid and (u).lock_expires_at = v_slots[1].lock_expires_at)
      from unnest(v_slots) u)
     and public._hold_group(v_ids[1], v_uid) = v_ids then
    return jsonb_build_object(
      'slot_ids', to_jsonb(v_ids), 'slot_id', v_ids[1],
      'lock_expires_at', v_slots[1].lock_expires_at,
      'seconds_left', greatest(0, floor(extract(epoch from v_slots[1].lock_expires_at - now())))::int,
      'total_lkr', (select sum((u).price_lkr) from unnest(v_slots) u),
      'reused', true);
  end if;

  foreach s in array v_slots loop
    if s.status::text <> 'available' then
      raise exception 'slot_unavailable' using errcode = 'P0001';
    end if;
    if (s.slot_date + s.start_time) <= public.colombo_now() then
      raise exception 'slot_in_past' using errcode = 'P0001';
    end if;
    if s.court_type::text in ('half_a', 'half_b') then
      if not coalesce(v_court.has_half_court, false) then
        raise exception 'half_court_not_offered' using errcode = 'P0001';
      end if;
      if s.start_time >= coalesce(v_court.half_court_cutoff, time '14:00') then
        raise exception 'half_court_after_cutoff' using errcode = 'P0001';
      end if;
    end if;
    if s.price_lkr is null or s.price_lkr <= 0 then
      raise exception 'slot_price_invalid' using errcode = 'P0001';
    end if;
    v_total := v_total + s.price_lkr;
  end loop;

  -- Any OTHER overlapping slot that is reserved, booked or blocked conflicts.

  if exists (
    select 1 from public.slots o
    where o.court_id = v_first.court_id
      and o.slot_date between v_first.slot_date - 1 and v_first.slot_date + 1
      and not (o.id = any (v_ids))
      and public.slot_period(o.slot_date, o.start_time, o.end_time)
          && tsrange(lower(public.slot_period(v_first.slot_date, v_first.start_time, v_first.end_time)),
                     upper(public.slot_period(v_last.slot_date, v_last.start_time, v_last.end_time)), '[)')
      and public.slot_parts(o.court_type::text) && public.slot_parts(v_first.court_type::text)
      and o.status::text in ('locked', 'booked', 'blocked')
  ) then
    raise exception 'slot_conflict' using errcode = 'P0001';
  end if;

  -- At most 3 reservations held at once per customer (a group counts once).
  select count(distinct x.lock_expires_at) into v_groups
  from public.slots x
  where x.locked_by = v_uid and x.status::text = 'locked' and x.lock_expires_at > now();
  if v_groups >= 3 then
    raise exception 'too_many_holds' using errcode = 'P0001';
  end if;

  v_expires := now() + interval '10 minutes';
  update public.slots x
  set status = 'locked', locked_by = v_uid, lock_expires_at = v_expires, version = x.version + 1
  where x.id = any (v_ids);

  perform public.write_audit(v_uid, 'user', 'slot.hold', 'slot', v_ids[1]::text,
    jsonb_build_object('slot_ids', to_jsonb(v_ids), 'lock_expires_at', v_expires, 'hours', v_n));

  return jsonb_build_object('slot_ids', to_jsonb(v_ids), 'slot_id', v_ids[1], 'lock_expires_at', v_expires,
                            'seconds_left', 600, 'total_lkr', v_total, 'reused', false);
end $$;
revoke all on function public.hold_slots(uuid[]) from public, anon;
grant execute on function public.hold_slots(uuid[]) to authenticated;

-- The single-slot entry point keeps its contract and delegates.
create or replace function public.hold_slot(p_slot_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select public.hold_slots(array[p_slot_id]) $$;
revoke all on function public.hold_slot(uuid) from public, anon;
grant execute on function public.hold_slot(uuid) to authenticated;

-- Release the caller's whole hold group that contains this slot.
create or replace function public.release_hold(p_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  v_ids := public._hold_group(p_slot_id, v_uid);
  update public.slots s
  set status = 'available', locked_by = null, lock_expires_at = null, version = s.version + 1
  where s.id = any (v_ids) and s.status::text = 'locked' and s.locked_by = v_uid;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform public.write_audit(v_uid, 'user', 'slot.release', 'slot', p_slot_id::text, jsonb_build_object('slot_ids', to_jsonb(v_ids)));
  end if;
  return jsonb_build_object('released', v_count > 0, 'count', v_count);
end $$;
revoke all on function public.release_hold(uuid) from public, anon;
grant execute on function public.release_hold(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Payments: one attempt per hold group; amount = sum of the group's prices.
-- ---------------------------------------------------------------------------
create or replace function public.payment_create_attempt(
  p_user_id uuid, p_slot_id uuid, p_provider text, p_environment text, p_min_seconds_left integer default 60
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_first public.slots%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_verified boolean;
  v_total numeric;
  v_bad integer;
  v_order text;
begin
  -- Lock the slot first, then resolve its group (rows of a group share expiry).
  perform 1 from public.slots s where s.id = p_slot_id for update;
  v_ids := public._hold_group(p_slot_id, p_user_id);
  if cardinality(v_ids) = 0 then
    raise exception 'hold_invalid_or_expiring' using errcode = 'P0001';
  end if;
  perform 1 from public.slots s where s.id = any (v_ids) order by s.id for update;

  select * into v_first from public.slots s where s.id = v_ids[1];
  if v_first.lock_expires_at <= now() + make_interval(secs => p_min_seconds_left) then
    raise exception 'hold_invalid_or_expiring' using errcode = 'P0001';
  end if;

  select coalesce(p.phone_verified, false) into v_verified from public.profiles p where p.id = p_user_id;
  if not coalesce(v_verified, false) then
    raise exception 'phone_not_verified' using errcode = 'P0001';
  end if;

  select sum(s.price_lkr), count(*) filter (where s.price_lkr is null or s.price_lkr <= 0)
  into v_total, v_bad from public.slots s where s.id = any (v_ids);
  if v_bad > 0 or v_total is null or v_total <= 0 then
    raise exception 'slot_price_invalid' using errcode = 'P0001';
  end if;

  select * into v_attempt from public.payment_attempts a
  where a.slot_id = v_ids[1] and a.user_id = p_user_id and a.hold_expires_at = v_first.lock_expires_at
    and a.status in ('initiated', 'pending')
  limit 1;

  if not found then
    v_order := 'AG' || to_char(public.colombo_now(), 'YYMMDDHH24MISS') || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    insert into public.payment_attempts (order_id, user_id, slot_id, slot_ids, court_id, amount_lkr, provider, environment, hold_expires_at)
    values (v_order, p_user_id, v_ids[1], v_ids, v_first.court_id, v_total, p_provider, p_environment, v_first.lock_expires_at)
    returning * into v_attempt;
    perform public.write_audit(p_user_id, 'user', 'payment.initiated', 'payment_attempt', v_attempt.order_id,
      jsonb_build_object('amount_lkr', v_total, 'slot_ids', to_jsonb(v_ids), 'provider', p_provider, 'environment', p_environment));
  end if;

  return jsonb_build_object(
    'order_id', v_attempt.order_id,
    'amount', to_char(v_attempt.amount_lkr, 'FM9999999990.00'),
    'currency', v_attempt.currency,
    'provider', v_attempt.provider,
    'environment', v_attempt.environment,
    'hold_expires_at', v_attempt.hold_expires_at,
    'slot_id', v_attempt.slot_id,
    'slot_ids', to_jsonb(v_attempt.slot_ids),
    'court_id', v_attempt.court_id
  );
end $$;
revoke all on function public.payment_create_attempt(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.payment_create_attempt(uuid, uuid, text, text, integer) to service_role;

-- Internal: confirm a verified successful payment against ALL hours of its hold.
-- Returns the new booking id, or null when the hold is no longer intact (then
-- nothing is changed and the caller records the payment as unconfirmed).
create or replace function public._confirm_attempt_slots(p_attempt public.payment_attempts, p_provider_payment_id text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
  v_booking_id uuid;
  v_n integer := cardinality(p_attempt.slot_ids);
begin
  perform 1 from public.slots s where s.id = any (p_attempt.slot_ids) order by s.id for update;

  select count(*) = v_n and bool_and(s.status::text = 'locked' and s.locked_by = p_attempt.user_id
                                    and s.lock_expires_at = p_attempt.hold_expires_at and s.lock_expires_at > now())
  into v_ok
  from public.slots s where s.id = any (p_attempt.slot_ids);

  if not coalesce(v_ok, false) then
    return null;
  end if;

  update public.slots s
  set status = 'booked', locked_by = null, lock_expires_at = null, version = s.version + 1
  where s.id = any (p_attempt.slot_ids);

  insert into public.bookings (user_id, slot_id, court_id, status, total_lkr, payhere_payment_id, idempotency_key)
  values (p_attempt.user_id, p_attempt.slot_id, p_attempt.court_id, 'confirmed', p_attempt.amount_lkr,
          coalesce(p_provider_payment_id, p_attempt.order_id), p_attempt.order_id)
  returning id into v_booking_id;

  insert into public.booking_slots (booking_id, slot_id)
  select v_booking_id, x from unnest(p_attempt.slot_ids) x;

  return v_booking_id;
end $$;
revoke all on function public._confirm_attempt_slots(public.payment_attempts, text) from public, anon, authenticated, service_role;

-- Re-define the notification handler: identical rules as before, but the
-- success branch confirms all hours of the attempt atomically (or none).
create or replace function public.payment_apply_notification(
  p_provider text,
  p_order_id text,
  p_provider_payment_id text,
  p_status_code integer,
  p_amount text,
  p_currency text,
  p_signature_valid boolean,
  p_event_key text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted boolean;
  v_attempt public.payment_attempts%rowtype;
  v_amount numeric;
  v_new_status text;
  v_result text;
  v_booking_id uuid;
  v_refund_id uuid;
begin
  insert into public.payment_events as e
    (provider, order_id, provider_payment_id, status_code, amount, currency, signature_valid, event_key, payload)
  values (p_provider, p_order_id, p_provider_payment_id, p_status_code, p_amount, p_currency,
          coalesce(p_signature_valid, false), p_event_key, coalesce(p_payload, '{}'::jsonb))
  on conflict (event_key) do update
    set duplicate_count = e.duplicate_count + 1, last_seen_at = now()
  returning (xmax = 0) into v_inserted;

  if not v_inserted then
    return jsonb_build_object('result', 'duplicate', 'order_id', p_order_id);
  end if;

  if not coalesce(p_signature_valid, false) then
    v_result := 'invalid_signature';
    perform public.record_app_event('warning', 'payment', 'notification_invalid_signature', p_order_id,
      jsonb_build_object('provider', p_provider), false);
    update public.payment_events set result = v_result where event_key = p_event_key;
    return jsonb_build_object('result', v_result, 'order_id', p_order_id);
  end if;

  select * into v_attempt from public.payment_attempts a where a.order_id = p_order_id for update;
  if not found then
    v_result := 'unknown_order';
    perform public.record_app_event('critical', 'payment', 'notification_unknown_order', p_order_id,
      jsonb_build_object('provider', p_provider, 'status_code', p_status_code, 'amount', p_amount), true);
    update public.payment_events set result = v_result where event_key = p_event_key;
    return jsonb_build_object('result', v_result, 'order_id', p_order_id);
  end if;

  if v_attempt.provider <> p_provider then
    v_result := 'provider_mismatch';
    perform public.record_app_event('critical', 'payment', 'notification_provider_mismatch', p_order_id,
      jsonb_build_object('expected', v_attempt.provider, 'got', p_provider), true);
    update public.payment_events set result = v_result where event_key = p_event_key;
    return jsonb_build_object('result', v_result, 'order_id', p_order_id);
  end if;

  begin
    v_amount := p_amount::numeric;
  exception when others then
    v_amount := null;
  end;
  if v_amount is null or p_currency is null then
    v_result := 'malformed';
  elsif v_amount <> v_attempt.amount_lkr or upper(p_currency) <> v_attempt.currency then
    v_result := 'amount_mismatch';
  end if;
  if v_result is not null then
    perform public.record_app_event('critical', 'payment', 'notification_' || v_result, p_order_id,
      jsonb_build_object('expected_amount', v_attempt.amount_lkr, 'amount', p_amount, 'currency', p_currency,
                         'status_code', p_status_code), true);
    if p_status_code = 2 then
      update public.payment_attempts
      set reconciliation_status = 'refund_required',
          reconciliation_note = 'Provider reported success with ' || v_result,
          provider_payment_id = coalesce(p_provider_payment_id, provider_payment_id),
          updated_at = now()
      where id = v_attempt.id;
    end if;
    update public.payment_events set result = v_result where event_key = p_event_key;
    return jsonb_build_object('result', v_result, 'order_id', p_order_id);
  end if;

  v_new_status := case p_status_code
    when 2 then 'succeeded' when 0 then 'pending' when -1 then 'cancelled'
    when -2 then 'failed' when -3 then 'charged_back' else null end;
  if v_new_status is null then
    v_result := 'unknown_status';
    perform public.record_app_event('error', 'payment', 'notification_unknown_status', p_order_id,
      jsonb_build_object('status_code', p_status_code), true);
    update public.payment_events set result = v_result where event_key = p_event_key;
    return jsonb_build_object('result', v_result, 'order_id', p_order_id);
  end if;

  if v_attempt.status in ('succeeded', 'succeeded_unconfirmed', 'charged_back') then
    if v_new_status = 'charged_back' and v_attempt.status <> 'charged_back' then
      update public.payment_attempts
      set status = 'charged_back', provider_status_code = p_status_code, updated_at = now(),
          reconciliation_note = 'Chargeback reported by provider'
      where id = v_attempt.id;
      perform public.record_app_event('critical', 'payment', 'chargeback', p_order_id,
        jsonb_build_object('booking_id', v_attempt.booking_id, 'amount_lkr', v_attempt.amount_lkr), true);
      v_result := 'charged_back';
    elsif v_new_status = 'succeeded' then
      v_result := 'already_confirmed';
    else
      v_result := 'stale_ignored';
    end if;
    update public.payment_events set result = v_result where event_key = p_event_key;
    return jsonb_build_object('result', v_result, 'order_id', p_order_id, 'booking_id', v_attempt.booking_id,
                              'user_id', v_attempt.user_id, 'slot_id', v_attempt.slot_id);
  end if;

  if v_new_status in ('pending', 'failed', 'cancelled', 'charged_back') then
    update public.payment_attempts
    set status = case when v_new_status = 'charged_back' then status else v_new_status end,
        provider_payment_id = coalesce(p_provider_payment_id, provider_payment_id),
        provider_status_code = p_status_code, updated_at = now()
    where id = v_attempt.id;
    v_result := v_new_status;
    update public.payment_events set result = v_result where event_key = p_event_key;
    return jsonb_build_object('result', v_result, 'order_id', p_order_id, 'user_id', v_attempt.user_id,
                              'slot_id', v_attempt.slot_id);
  end if;

  v_booking_id := public._confirm_attempt_slots(v_attempt, p_provider_payment_id);

  if v_booking_id is not null then
    update public.payment_attempts
    set status = 'succeeded', booking_id = v_booking_id, confirmed_at = now(),
        provider_payment_id = coalesce(p_provider_payment_id, provider_payment_id),
        provider_status_code = p_status_code, updated_at = now()
    where id = v_attempt.id;

    insert into public.payment_audit (payhere_payment_id, entity_type, entity_id, event_type, amount_lkr, raw_payload)
    values (coalesce(p_provider_payment_id, v_attempt.order_id), 'booking', v_attempt.slot_id, 'completed', v_attempt.amount_lkr,
            jsonb_build_object('order_id', v_attempt.order_id, 'provider', p_provider, 'slot_ids', to_jsonb(v_attempt.slot_ids),
                               'environment', v_attempt.environment, 'simulated', p_provider = 'simulator'))
    on conflict do nothing;

    perform public.write_audit(v_attempt.user_id, 'provider', 'booking.confirmed', 'booking', v_booking_id::text,
      jsonb_build_object('order_id', v_attempt.order_id, 'amount_lkr', v_attempt.amount_lkr,
                         'hours', cardinality(v_attempt.slot_ids), 'court_id', v_attempt.court_id));
    v_result := 'confirmed';
  else
    update public.payment_attempts
    set status = 'succeeded_unconfirmed', reconciliation_status = 'refund_required',
        reconciliation_note = 'Payment succeeded after the hold ended; slot was not confirmed',
        provider_payment_id = coalesce(p_provider_payment_id, provider_payment_id),
        provider_status_code = p_status_code, updated_at = now()
    where id = v_attempt.id;

    insert into public.refunds (payment_attempt_id, amount_lkr, status, note)
    values (v_attempt.id, v_attempt.amount_lkr, 'pending', 'Auto: paid after hold expired')
    on conflict do nothing
    returning id into v_refund_id;

    perform public.record_app_event('critical', 'payment', 'paid_without_booking', v_attempt.order_id,
      jsonb_build_object('slot_ids', to_jsonb(v_attempt.slot_ids), 'amount_lkr', v_attempt.amount_lkr,
                         'refund_id', v_refund_id), true);
    v_result := 'paid_unconfirmed';
  end if;

  update public.payment_events set result = v_result where event_key = p_event_key;
  return jsonb_build_object('result', v_result, 'order_id', v_attempt.order_id, 'booking_id', v_booking_id,
                            'user_id', v_attempt.user_id, 'slot_id', v_attempt.slot_id,
                            'slot_ids', to_jsonb(v_attempt.slot_ids),
                            'amount', to_char(v_attempt.amount_lkr, 'FM9999999990.00'));
end $$;
revoke all on function public.payment_apply_notification(text, text, text, integer, text, text, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.payment_apply_notification(text, text, text, integer, text, text, boolean, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Booking notice / cancellation: work across all hours of a booking.
-- ---------------------------------------------------------------------------
create or replace function public._booking_notice(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with hrs as (
    select s.* from public.booking_slots bs join public.slots s on s.id = bs.slot_id where bs.booking_id = p_booking_id
    union
    select s.* from public.bookings b join public.slots s on s.id = b.slot_id where b.id = p_booking_id
  )
  select jsonb_build_object(
    'booking_id', b.id,
    'user_id', b.user_id,
    'status', b.status,
    'amount', to_char(b.total_lkr, 'FM9999999990.00'),
    'customer_phone', p.phone,
    'customer_name', p.full_name,
    'court_name', c.name,
    'court_type', (select h.court_type from hrs h order by h.start_time limit 1),
    'slot_date', (select h.slot_date from hrs h order by h.slot_date, h.start_time limit 1),
    'start_time', (select to_char(h.start_time, 'HH24:MI') from hrs h order by h.slot_date, h.start_time limit 1),
    'end_time', (select to_char(h.end_time, 'HH24:MI') from hrs h order by h.slot_date desc, h.start_time desc limit 1),
    'hours', (select sum(public.slot_hours(h.start_time, h.end_time)) from hrs h),
    'reason', b.cancellation_reason
  )
  from public.bookings b
  left join public.courts c on c.id = b.court_id
  left join public.profiles p on p.id = b.user_id
  where b.id = p_booking_id
$$;
revoke all on function public._booking_notice(uuid) from public, anon, authenticated, service_role;

create or replace function public.request_booking_cancellation(p_booking_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  b public.bookings%rowtype;
  v_start timestamp;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into b from public.bookings x where x.id = p_booking_id for update;
  if not found or b.user_id <> v_uid then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;

  if b.status::text = 'cancellation_requested' then
    return jsonb_build_object('changed', false) || public._booking_notice(b.id);
  end if;
  if b.status::text <> 'confirmed' then
    raise exception 'booking_not_cancellable' using errcode = 'P0001';
  end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'invalid_reason' using errcode = 'P0001';
  end if;

  -- 24-hour rule from the FIRST hour of the booking, Asia/Colombo.
  select min(s.slot_date + s.start_time) into v_start
  from public.slots s
  where s.id = b.slot_id or s.id in (select bs.slot_id from public.booking_slots bs where bs.booking_id = b.id);
  if v_start is null or v_start - public.colombo_now() < interval '24 hours' then
    raise exception 'cancellation_window_closed' using errcode = 'P0001';
  end if;

  update public.bookings
  set status = 'cancellation_requested', cancellation_reason = v_reason, cancellation_requested_at = now(),
      decided_by = null, decision_note = null
  where id = b.id;

  perform public.write_audit(v_uid, 'user', 'booking.cancellation_requested', 'booking', b.id::text,
                             jsonb_build_object('reason', v_reason));
  return jsonb_build_object('changed', true) || public._booking_notice(b.id);
end $$;
revoke all on function public.request_booking_cancellation(uuid, text) from public, anon;
grant execute on function public.request_booking_cancellation(uuid, text) to authenticated;

create or replace function public.admin_decide_cancellation(p_booking_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  b public.bookings%rowtype;
  v_attempt_id uuid;
  v_refund_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;

  select * into b from public.bookings x where x.id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;

  if p_decision = 'approve' then
    if b.status::text = 'cancelled' then
      return jsonb_build_object('changed', false, 'decision', p_decision,
        'refund_id', (select r.id from public.refunds r where r.booking_id = b.id)) || public._booking_notice(b.id);
    end if;
    if b.status::text <> 'cancellation_requested' then
      raise exception 'booking_not_pending_cancellation' using errcode = 'P0001';
    end if;

    perform 1 from public.slots s
    where s.id = b.slot_id or s.id in (select bs.slot_id from public.booking_slots bs where bs.booking_id = b.id)
    order by s.id for update;

    update public.bookings
    set status = 'cancelled', cancelled_by = 'admin', cancelled_at = now(), refund_amount_lkr = b.total_lkr,
        decided_by = v_uid, decision_note = nullif(btrim(coalesce(p_note, '')), '')
    where id = b.id;

    -- Release every hour of the booking.
    update public.slots s
    set status = 'available', locked_by = null, lock_expires_at = null, version = s.version + 1
    where (s.id = b.slot_id or s.id in (select bs.slot_id from public.booking_slots bs where bs.booking_id = b.id))
      and s.status::text = 'booked';

    select a.id into v_attempt_id from public.payment_attempts a where a.booking_id = b.id limit 1;
    insert into public.refunds (booking_id, payment_attempt_id, amount_lkr, status, created_by, updated_by)
    values (b.id, v_attempt_id, b.total_lkr, 'pending', v_uid, v_uid)
    on conflict do nothing
    returning id into v_refund_id;
    if v_refund_id is null then
      select r.id into v_refund_id from public.refunds r where r.booking_id = b.id;
    end if;

    perform public.write_audit(v_uid, 'admin', 'booking.cancellation_approved', 'booking', b.id::text,
      jsonb_build_object('refund_id', v_refund_id, 'amount_lkr', b.total_lkr));
    return jsonb_build_object('changed', true, 'decision', p_decision, 'refund_id', v_refund_id) || public._booking_notice(b.id);
  end if;

  if b.status::text = 'confirmed' and b.decided_by is not null then
    return jsonb_build_object('changed', false, 'decision', p_decision) || public._booking_notice(b.id);
  end if;
  if b.status::text <> 'cancellation_requested' then
    raise exception 'booking_not_pending_cancellation' using errcode = 'P0001';
  end if;
  update public.bookings
  set status = 'confirmed', decided_by = v_uid, decision_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = b.id;
  perform public.write_audit(v_uid, 'admin', 'booking.cancellation_rejected', 'booking', b.id::text, '{}'::jsonb);
  return jsonb_build_object('changed', true, 'decision', p_decision) || public._booking_notice(b.id);
end $$;
revoke all on function public.admin_decide_cancellation(uuid, text, text) from public, anon;
grant execute on function public.admin_decide_cancellation(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Idempotent slot generation (server-side). Uses each court's own operating
-- hours, slot length, half-court setting and cut-off; price = hourly tier x
-- hours. Existing slots (any status) are never touched: re-running creates
-- only what is missing.
-- ---------------------------------------------------------------------------
create or replace function public._generate_court_slots(p_court_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.courts%rowtype;
  v_date date;
  v_start_min integer;
  v_end_min integer;
  v_len integer;
  v_m integer;
  v_s time;
  v_e time;
  v_type text;
  v_price numeric;
  v_created integer := 0;
  v_existing integer := 0;
  v_rows integer;
begin
  select * into c from public.courts x where x.id = p_court_id;
  if not found then
    raise exception 'court_not_found' using errcode = 'P0002';
  end if;
  if p_to < p_from or (p_to - p_from) > 120 then
    raise exception 'invalid_date_range' using errcode = '22023';
  end if;

  v_start_min := extract(hour from c.operating_start)::int * 60 + extract(minute from c.operating_start)::int;
  v_end_min := extract(hour from c.operating_end)::int * 60 + extract(minute from c.operating_end)::int;
  if v_end_min = 0 then v_end_min := 1440; end if;
  v_len := c.slot_duration_hrs * 60;
  if v_len <= 0 or v_end_min <= v_start_min then
    raise exception 'court_hours_invalid' using errcode = 'P0001';
  end if;

  for v_date in select d::date from generate_series(p_from, p_to, interval '1 day') d loop
    v_m := v_start_min;
    while v_m + v_len <= v_end_min loop
      v_s := make_time(v_m / 60, v_m % 60, 0);
      v_e := case when v_m + v_len = 1440 then time '00:00' else make_time((v_m + v_len) / 60, (v_m + v_len) % 60, 0) end;
      foreach v_type in array case
          when coalesce(c.has_half_court, false) and v_s < coalesce(c.half_court_cutoff, time '14:00')
            then array['full_court', 'half_a', 'half_b']
          else array['full_court'] end
      loop
        v_price := public.court_hourly_price(c.id, v_type, v_s);
        if v_price is null or v_price <= 0 then
          raise exception 'pricing_missing' using errcode = 'P0001',
            detail = format('No hourly price for %s at %s on court %s', v_type, v_s, c.id);
        end if;
        insert into public.slots (court_id, slot_date, start_time, end_time, court_type, status, price_lkr, version)
        values (c.id, v_date, v_s, v_e, v_type, 'available', round(v_price * v_len / 60.0, 2), 0)
        on conflict do nothing;
        get diagnostics v_rows = row_count;
        if v_rows > 0 then v_created := v_created + 1; else v_existing := v_existing + 1; end if;
      end loop;
      v_m := v_m + v_len;
    end loop;
  end loop;

  return jsonb_build_object('court_id', c.id, 'from', p_from, 'to', p_to, 'created', v_created, 'already_existed', v_existing);
end $$;
revoke all on function public._generate_court_slots(uuid, date, date) from public, anon, authenticated, service_role;

create or replace function public.admin_generate_court_slots(p_court_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from < (public.colombo_now())::date then
    raise exception 'invalid_date_range' using errcode = '22023';
  end if;
  v_r := public._generate_court_slots(p_court_id, p_from, p_to);
  perform public.write_audit(auth.uid(), 'admin', 'slots.generate', 'court', p_court_id::text, v_r);
  return v_r;
end $$;
revoke all on function public.admin_generate_court_slots(uuid, date, date) from public, anon;
grant execute on function public.admin_generate_court_slots(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Daily report: add bookings by court and by duration (confirmed in period).
-- ---------------------------------------------------------------------------
create or replace function public.report_bookings_by_court(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(court_name, by_duration), '{}'::jsonb)
  from (
    select court_name, jsonb_object_agg(hours || 'h', jsonb_build_object('count', n, 'lkr', lkr)) as by_duration
    from (
      select c.name as court_name,
             trim(trailing '.' from trim(trailing '0' from (select sum(public.slot_hours(s.start_time, s.end_time))
               from public.slots s where s.id = any (a.slot_ids))::text)) as hours,
             count(*) as n, sum(a.amount_lkr) as lkr
      from public.payment_attempts a
      join public.courts c on c.id = a.court_id
      where a.status = 'succeeded' and a.environment = 'live' and a.confirmed_at >= p_from and a.confirmed_at < p_to
      group by 1, 2
    ) x
    group by court_name
  ) y
$$;
revoke all on function public.report_bookings_by_court(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.report_bookings_by_court(timestamptz, timestamptz) to service_role;
