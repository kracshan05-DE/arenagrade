-- ArenaGrade 1000: full-court-only days + audit fixes (owner decisions 2026-10-22).
--
--   1. Weekends: on courts with weekend_full_court_only = true (St. Mary's),
--      Saturday and Sunday (Asia/Colombo dates) are full court only, all day.
--      The 2-hour full-court slots are unchanged.
--   2. Holidays (Poya etc.): admins mark a date "full court only" per court.
--   3. Unused half-court slots already generated for those days are deleted
--      (owner approved). Booked, held and blocked rows are never deleted.
--   4. Audit C5: browsers (including admins) can no longer INSERT or UPDATE
--      slots directly; every change goes through checked functions.
--   5. Audit C10: admin test bookings only work while booking_mode = 'admin_only'.
--
-- Safe to re-run: every statement is idempotent.
-- Depends on 0100-0900.

-- ---------------------------------------------------------------------------
-- 1. Data model
-- ---------------------------------------------------------------------------
alter table public.courts add column if not exists weekend_full_court_only boolean not null default false;

-- St. Mary's (the only court with halves) gets the weekend rule. Runs only
-- once (marker below), so an admin can later switch it off without a re-run
-- of this file switching it back on.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_description d
                 join pg_catalog.pg_class c on c.oid = d.objoid
                 where c.oid = 'public.courts'::regclass and d.objsubid > 0
                   and d.description like 'Saturday and Sunday are full court only%') then
    update public.courts set weekend_full_court_only = true where coalesce(has_half_court, false);
  end if;
end $$;
comment on column public.courts.weekend_full_court_only is
  'Saturday and Sunday are full court only (no half-court slots). Set by migration 1000.';

create table if not exists public.full_court_only_dates (
  court_id uuid not null references public.courts(id) on delete cascade,
  day date not null,
  reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (court_id, day)
);
alter table public.full_court_only_dates enable row level security;
revoke insert, update, delete, truncate on public.full_court_only_dates from anon, authenticated;
grant select on public.full_court_only_dates to anon, authenticated;
drop policy if exists full_court_only_dates_public_read on public.full_court_only_dates;
create policy full_court_only_dates_public_read on public.full_court_only_dates
  for select to anon, authenticated using (true);

create or replace function public.is_full_court_only_day(p_court_id uuid, p_day date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.weekend_full_court_only from public.courts c where c.id = p_court_id), false)
           and extract(isodow from p_day) in (6, 7)
      or exists (select 1 from public.full_court_only_dates f where f.court_id = p_court_id and f.day = p_day)
$$;
revoke all on function public.is_full_court_only_day(uuid, date) from public, anon, authenticated;
grant execute on function public.is_full_court_only_day(uuid, date) to service_role;

-- ---------------------------------------------------------------------------
-- 2. The rule, enforced on the table itself, so it holds for every path
--    (holds, payments, generators, recurring blocks, SQL scripts).
--    On a full-court-only day a half-court row may not be created as
--    available/held/booked, and may not become held or booked. Blocked rows
--    (admin decisions) and releases back to 'available' are allowed.
-- ---------------------------------------------------------------------------
create or replace function public.slots_enforce_full_court_days()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.court_type::text in ('half_a', 'half_b')
     and public.is_full_court_only_day(new.court_id, new.slot_date)
     and (
       (tg_op = 'INSERT' and new.status::text in ('available', 'locked', 'booked'))
       or (tg_op = 'UPDATE' and new.status::text in ('locked', 'booked')
           and (new.status is distinct from old.status or new.slot_date is distinct from old.slot_date
                or new.court_type is distinct from old.court_type))
     ) then
    raise exception 'half_court_not_offered_today' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.slots_enforce_full_court_days() from public, anon, authenticated;

drop trigger if exists slots_enforce_full_court_days on public.slots;
create trigger slots_enforce_full_court_days
  before insert or update on public.slots
  for each row execute function public.slots_enforce_full_court_days();

-- ---------------------------------------------------------------------------
-- 3. Slot generator: same as 0800, but skips half courts on full-court-only
--    days (otherwise the trigger above would stop the whole generation).
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
  v_full_only boolean;
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
    v_full_only := public.is_full_court_only_day(c.id, v_date);
    v_m := v_start_min;
    while v_m + v_len <= v_end_min loop
      v_s := make_time(v_m / 60, v_m % 60, 0);
      v_e := case when v_m + v_len = 1440 then time '00:00' else make_time((v_m + v_len) / 60, (v_m + v_len) % 60, 0) end;
      foreach v_type in array case
          when coalesce(c.has_half_court, false) and not v_full_only and v_s < coalesce(c.half_court_cutoff, time '14:00')
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

-- Deletes unused half-court slots of one court on one date (or on every
-- future full-court-only date when p_day is null). "Unused" = available and
-- never referenced by a booking or payment attempt.
create or replace function public._delete_unused_half_slots(p_court_id uuid, p_day date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  delete from public.slots s
  where s.court_id = p_court_id
    and s.court_type::text in ('half_a', 'half_b')
    and s.status::text = 'available'
    and (case when p_day is null
              then s.slot_date >= (public.colombo_now())::date and public.is_full_court_only_day(s.court_id, s.slot_date)
              else s.slot_date = p_day end)
    and not exists (select 1 from public.bookings b where b.slot_id = s.id)
    and not exists (select 1 from public.booking_slots bs where bs.slot_id = s.id)
    and not exists (select 1 from public.payment_attempts a where a.slot_id = s.id or s.id = any (a.slot_ids));
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public._delete_unused_half_slots(uuid, date) from public, anon, authenticated, service_role;

-- Owner-approved clean-up: unused half-court slots on future weekends.
do $$
declare
  v_court uuid;
  v_n integer;
  v_total integer := 0;
begin
  for v_court in select id from public.courts where weekend_full_court_only loop
    v_n := public._delete_unused_half_slots(v_court, null);
    v_total := v_total + v_n;
  end loop;
  raise notice 'Deleted % unused half-court slots on future full-court-only days', v_total;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Admin: mark / unmark a date as full court only (holidays, Poya days).
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_full_court_only_day(
  p_court_id uuid, p_day date, p_full_court_only boolean, p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_court public.courts%rowtype;
  v_busy integer;
  v_deleted integer := 0;
  v_gen jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_court from public.courts c where c.id = p_court_id;
  if not found then
    raise exception 'court_not_found' using errcode = 'P0002';
  end if;
  if not coalesce(v_court.has_half_court, false) then
    raise exception 'half_court_not_offered' using errcode = 'P0001';
  end if;
  if p_day is null or p_day < (public.colombo_now())::date then
    raise exception 'invalid_date' using errcode = '22023';
  end if;
  if v_reason is not null and length(v_reason) > 100 then
    raise exception 'invalid_reason' using errcode = 'P0001';
  end if;

  -- Serialise with holds and generation on this court and day.
  perform 1 from public.slots s where s.court_id = p_court_id and s.slot_date = p_day order by s.id for update;

  if p_full_court_only then
    select count(*) into v_busy from public.slots s
    where s.court_id = p_court_id and s.slot_date = p_day
      and s.court_type::text in ('half_a', 'half_b') and s.status::text in ('locked', 'booked');
    if v_busy > 0 then
      raise exception 'half_court_bookings_exist' using errcode = 'P0001',
        detail = format('%s half-court slots on %s are booked or reserved. Cancel them first.', v_busy, p_day);
    end if;
    insert into public.full_court_only_dates (court_id, day, reason, created_by)
    values (p_court_id, p_day, v_reason, v_uid)
    on conflict (court_id, day) do update set reason = excluded.reason;
    v_deleted := public._delete_unused_half_slots(p_court_id, p_day);
  else
    delete from public.full_court_only_dates f where f.court_id = p_court_id and f.day = p_day;
    -- Recreate the half-court slots unless the weekend rule still applies.
    if not public.is_full_court_only_day(p_court_id, p_day) then
      v_gen := public._generate_court_slots(p_court_id, p_day, p_day);
    end if;
  end if;

  perform public.write_audit(v_uid, 'admin', 'slots.full_court_only_day', 'court', p_court_id::text,
    jsonb_build_object('day', p_day, 'full_court_only', p_full_court_only, 'reason', v_reason,
                       'half_slots_deleted', v_deleted, 'generated', v_gen));
  return jsonb_build_object('day', p_day,
    'full_court_only', public.is_full_court_only_day(p_court_id, p_day),
    'weekend_rule', coalesce(v_court.weekend_full_court_only, false) and extract(isodow from p_day) in (6, 7),
    'half_slots_deleted', v_deleted,
    'half_slots_created', coalesce((v_gen ->> 'created')::int, 0));
end $$;
revoke all on function public.admin_set_full_court_only_day(uuid, date, boolean, text) from public, anon;
grant execute on function public.admin_set_full_court_only_day(uuid, date, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Audit C5: no direct browser writes to slots. Admin pages use
--    admin_block_slot / admin_unblock_slot / admin_generate_court_slots,
--    which check clashes. Deleting unused (available/blocked) slots stays.
-- ---------------------------------------------------------------------------
drop policy if exists slots_admin_insert on public.slots;
drop policy if exists slots_admin_update on public.slots;
revoke insert, update, truncate on public.slots from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Audit C10: admin test bookings only during the admin-only (testing) mode.
-- ---------------------------------------------------------------------------
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
  if public.booking_mode() <> 'admin_only' then
    raise exception 'test_bookings_only_in_testing_mode' using errcode = 'P0001';
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
