-- ArenaGrade production-readiness: authoritative booking integrity.
--
-- Booking model (verified from app code): fixed slot rows per court, date,
-- start/end time and court_type in ('full_court','half_a','half_b').
-- Club rules (confirmed by the owner, 2026-10-17):
--   * full_court conflicts with half_a and half_b at overlapping times;
--     half_a and half_b do not conflict with each other
--   * full court bookable at any time; half courts only when the slot STARTS
--     before courts.half_court_cutoff (default 14:00), Asia/Colombo local time
--   * a 10-minute hold, timed by the database clock, reserves the slot
--   * a practice/recurring block must not override a booking or active hold
--
-- Enforcement layers:
--   1. EXCLUDE constraint: no two locked/booked slots may overlap in court part
--      and time. Holds in the database itself, for every write path.
--   2. hold_slot(): locks the whole conflict neighbourhood in a fixed order,
--      releases expired holds, then checks blocks, cutoff, price and limits.
--   3. Direct customer writes to slots are removed by the RLS migration.

-- 0. Release holds that have already expired, so they cannot block the
--    constraint below or keep courts unavailable.
update public.slots
set status = 'available', locked_by = null, lock_expires_at = null, version = coalesce(version, 0) + 1
where status::text = 'locked' and (lock_expires_at is null or lock_expires_at <= now());

-- 1. Natural key: one slot row per court/date/start/court type, whatever the
--    status. Production only has idx_slots_active, which is PARTIAL (locked/
--    booked only), so duplicate available/blocked rows are currently possible
--    and the recurring screen's upsert(onConflict) has no matching key.
--    Verified 2026-10-18: duplicate_slot_keys = 0, so this is safe to create.
do $$
begin
  if not exists (
    select 1
    from pg_index i
    join pg_class t on t.oid = i.indrelid
    where t.oid = 'public.slots'::regclass and i.indisunique and i.indpred is null
      and (select array_agg(a.attname::text order by a.attname)
           from pg_attribute a where a.attrelid = t.oid and a.attnum = any (i.indkey))
          = array['court_id', 'court_type', 'slot_date', 'start_time']
  ) then
    create unique index slots_natural_key on public.slots (court_id, slot_date, start_time, court_type);
  end if;
end $$;

-- 2. The authoritative conflict rule.
alter table public.slots
  add constraint slots_no_conflicting_active
  exclude using gist (
    court_id with =,
    (case court_type::text when 'half_a' then int4range(1, 2) when 'half_b' then int4range(2, 3) else int4range(1, 3) end) with &&,
    (public.slot_period(slot_date, start_time, end_time)) with &&
  )
  where (status::text in ('locked', 'booked'));

-- 3. A lock must always carry an owner and an expiry. NOT VALID: enforced for
--    every new write; existing rows were cleaned in step 0.
alter table public.slots
  add constraint slots_lock_has_owner_and_expiry
  check (status::text <> 'locked' or (locked_by is not null and lock_expires_at is not null)) not valid;

create index if not exists slots_court_date_idx on public.slots (court_id, slot_date);
create index if not exists slots_locked_by_idx on public.slots (locked_by) where status::text = 'locked';

-- 4. One live booking per slot.
create unique index if not exists bookings_one_live_per_slot
  on public.bookings (slot_id) where status::text in ('confirmed', 'cancellation_requested');
-- (bookings.idempotency_key is already UNIQUE in production.)

-- ---------------------------------------------------------------------------
-- Internal: lock every slot that could conflict with (court, date, start, end,
-- type), in id order, so concurrent callers never deadlock. Then release the
-- expired holds among them. Returns nothing; callers re-read what they need.
-- ---------------------------------------------------------------------------
create or replace function public._lock_slot_neighbourhood(
  p_court_id uuid, p_date date, p_start time, p_end time, p_court_type text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period tsrange := public.slot_period(p_date, p_start, p_end);
  v_parts int4range := public.slot_parts(p_court_type);
begin
  perform 1
  from public.slots s
  where s.court_id = p_court_id
    and s.slot_date between p_date - 1 and p_date + 1
    and public.slot_period(s.slot_date, s.start_time, s.end_time) && v_period
    and public.slot_parts(s.court_type::text) && v_parts
  order by s.id
  for update;

  update public.slots s
  set status = 'available', locked_by = null, lock_expires_at = null, version = s.version + 1
  where s.court_id = p_court_id
    and s.slot_date between p_date - 1 and p_date + 1
    and public.slot_period(s.slot_date, s.start_time, s.end_time) && v_period
    and public.slot_parts(s.court_type::text) && v_parts
    and s.status::text = 'locked'
    and (s.lock_expires_at is null or s.lock_expires_at <= now());
end $$;
revoke all on function public._lock_slot_neighbourhood(uuid, date, time, time, text) from public, anon, authenticated;

-- Internal: does any OTHER slot in the neighbourhood have one of p_statuses?
create or replace function public._slot_has_conflict(
  p_slot_id uuid, p_court_id uuid, p_date date, p_start time, p_end time, p_court_type text, p_statuses text[]
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.slots s
    where s.court_id = p_court_id
      and s.slot_date between p_date - 1 and p_date + 1
      and (p_slot_id is null or s.id <> p_slot_id)
      and public.slot_period(s.slot_date, s.start_time, s.end_time) && public.slot_period(p_date, p_start, p_end)
      and public.slot_parts(s.court_type::text) && public.slot_parts(p_court_type)
      and s.status::text = any (p_statuses)
  )
$$;
revoke all on function public._slot_has_conflict(uuid, uuid, date, time, time, text, text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Customer: place (or re-read) a 10-minute hold.
-- Errors: not_authenticated, slot_not_found, slot_unavailable, slot_conflict,
--         slot_in_past, court_unavailable, half_court_not_offered,
--         half_court_after_cutoff, slot_price_invalid, too_many_holds
-- ---------------------------------------------------------------------------
create or replace function public.hold_slot(p_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_slot public.slots%rowtype;
  v_court public.courts%rowtype;
  v_expires timestamptz;
  v_active integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- One hold operation per customer at a time (stops parallel tabs racing the
  -- per-customer hold limit).
  perform pg_advisory_xact_lock(hashtextextended('hold_user:' || v_uid::text, 0));

  select * into v_slot from public.slots s where s.id = p_slot_id;
  if not found then
    raise exception 'slot_not_found' using errcode = 'P0002';
  end if;

  perform public._lock_slot_neighbourhood(v_slot.court_id, v_slot.slot_date, v_slot.start_time, v_slot.end_time, v_slot.court_type::text);
  select * into v_slot from public.slots s where s.id = p_slot_id;

  -- Retry / second tab by the same customer: return the existing hold. The
  -- expiry is never extended, so a hold cannot be kept alive indefinitely.
  if v_slot.status::text = 'locked' and v_slot.locked_by = v_uid then
    return jsonb_build_object(
      'slot_id', v_slot.id,
      'lock_expires_at', v_slot.lock_expires_at,
      'seconds_left', greatest(0, floor(extract(epoch from v_slot.lock_expires_at - now())))::int,
      'reused', true
    );
  end if;

  if v_slot.status::text <> 'available' then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end if;

  select * into v_court from public.courts c where c.id = v_slot.court_id;
  if not found or not coalesce(v_court.is_active, false) then
    raise exception 'court_unavailable' using errcode = 'P0001';
  end if;

  if (v_slot.slot_date + v_slot.start_time) <= public.colombo_now() then
    raise exception 'slot_in_past' using errcode = 'P0001';
  end if;

  if v_slot.court_type::text in ('half_a', 'half_b') then
    if not coalesce(v_court.has_half_court, false) then
      raise exception 'half_court_not_offered' using errcode = 'P0001';
    end if;
    if v_slot.start_time >= coalesce(v_court.half_court_cutoff, time '14:00') then
      raise exception 'half_court_after_cutoff' using errcode = 'P0001';
    end if;
  end if;

  if v_slot.price_lkr is null or v_slot.price_lkr <= 0 then
    raise exception 'slot_price_invalid' using errcode = 'P0001';
  end if;

  if public._slot_has_conflict(v_slot.id, v_slot.court_id, v_slot.slot_date, v_slot.start_time, v_slot.end_time,
                               v_slot.court_type::text, array['locked', 'booked', 'blocked']) then
    raise exception 'slot_conflict' using errcode = 'P0001';
  end if;

  select count(*) into v_active
  from public.slots s
  where s.locked_by = v_uid and s.status::text = 'locked' and s.lock_expires_at > now();
  if v_active >= 3 then
    raise exception 'too_many_holds' using errcode = 'P0001';
  end if;

  v_expires := now() + interval '10 minutes';
  update public.slots s
  set status = 'locked', locked_by = v_uid, lock_expires_at = v_expires, version = s.version + 1
  where s.id = v_slot.id;

  perform public.write_audit(v_uid, 'user', 'slot.hold', 'slot', v_slot.id::text,
                             jsonb_build_object('lock_expires_at', v_expires));

  return jsonb_build_object('slot_id', v_slot.id, 'lock_expires_at', v_expires, 'seconds_left', 600, 'reused', false);
end $$;
revoke all on function public.hold_slot(uuid) from public, anon;
grant execute on function public.hold_slot(uuid) to authenticated;

-- Customer: give up their own hold (back button, timer end).
create or replace function public.release_hold(p_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  update public.slots s
  set status = 'available', locked_by = null, lock_expires_at = null, version = s.version + 1
  where s.id = p_slot_id and s.status::text = 'locked' and s.locked_by = v_uid;
  get diagnostics v_count = row_count;

  if v_count > 0 then
    perform public.write_audit(v_uid, 'user', 'slot.release', 'slot', p_slot_id::text, '{}'::jsonb);
  end if;
  return jsonb_build_object('released', v_count > 0);
end $$;
revoke all on function public.release_hold(uuid) from public, anon;
grant execute on function public.release_hold(uuid) to authenticated;

-- Housekeeping (pg_cron / daily job). Correctness never depends on it: every
-- hold path already treats expired holds as free.
create or replace function public.expire_stale_holds()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.slots s
  set status = 'available', locked_by = null, lock_expires_at = null, version = s.version + 1
  where s.status::text = 'locked' and (s.lock_expires_at is null or s.lock_expires_at <= now());
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.expire_stale_holds() from public, anon, authenticated;
grant execute on function public.expire_stale_holds() to service_role;

-- ---------------------------------------------------------------------------
-- Admin: block / unblock a slot (club practice or custom reason).
-- Refuses when the block would overlap a booking or an active customer hold.
-- ---------------------------------------------------------------------------
create or replace function public.admin_block_slot(p_slot_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_slot public.slots%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) > 200 then
    raise exception 'invalid_reason' using errcode = 'P0001';
  end if;

  select * into v_slot from public.slots s where s.id = p_slot_id;
  if not found then
    raise exception 'slot_not_found' using errcode = 'P0002';
  end if;
  perform public._lock_slot_neighbourhood(v_slot.court_id, v_slot.slot_date, v_slot.start_time, v_slot.end_time, v_slot.court_type::text);
  select * into v_slot from public.slots s where s.id = p_slot_id;

  if v_slot.status::text = 'blocked' then
    update public.slots s set internal_reason = v_reason where s.id = v_slot.id;
    return jsonb_build_object('changed', false, 'status', 'blocked');
  end if;
  if v_slot.status::text <> 'available' then
    raise exception 'block_conflicts_with_booking' using errcode = 'P0001';
  end if;
  if public._slot_has_conflict(v_slot.id, v_slot.court_id, v_slot.slot_date, v_slot.start_time, v_slot.end_time,
                               v_slot.court_type::text, array['locked', 'booked']) then
    raise exception 'block_conflicts_with_booking' using errcode = 'P0001';
  end if;

  update public.slots s
  set status = 'blocked', internal_reason = v_reason, version = s.version + 1
  where s.id = v_slot.id;

  perform public.write_audit(v_uid, 'admin', 'slot.block', 'slot', v_slot.id::text, jsonb_build_object('reason', v_reason));
  return jsonb_build_object('changed', true, 'status', 'blocked');
end $$;
revoke all on function public.admin_block_slot(uuid, text) from public, anon;
grant execute on function public.admin_block_slot(uuid, text) to authenticated;

create or replace function public.admin_unblock_slot(p_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if not public.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.slots s
  set status = 'available', internal_reason = null, version = s.version + 1
  where s.id = p_slot_id and s.status::text = 'blocked';
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform public.write_audit(v_uid, 'admin', 'slot.unblock', 'slot', p_slot_id::text, '{}'::jsonb);
  end if;
  return jsonb_build_object('changed', v_count > 0);
end $$;
revoke all on function public.admin_unblock_slot(uuid) from public, anon;
grant execute on function public.admin_unblock_slot(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: generate blocked slots for a recurring (corporate) booking.
-- Replaces the client-side upsert, which could overwrite a customer's booked
-- slot with 'blocked'. Dates are computed in the database (Asia/Colombo), not
-- in the admin's browser timezone. Past dates are skipped.
-- ---------------------------------------------------------------------------
create or replace function public.admin_generate_recurring_slots(p_recurring_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r public.recurring_bookings%rowtype;
  v_today date := (public.colombo_now())::date;
  v_date date;
  v_existing public.slots%rowtype;
  v_created integer := 0;
  v_converted integer := 0;
  v_already integer := 0;
  v_conflicts jsonb := '[]'::jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into r from public.recurring_bookings rb where rb.id = p_recurring_id;
  if not found then
    raise exception 'recurring_not_found' using errcode = 'P0002';
  end if;
  if r.date_to < r.date_from or r.day_of_week not between 0 and 6 or r.end_time = r.start_time
     or r.court_type::text not in ('full_court', 'half_a', 'half_b') then
    raise exception 'recurring_invalid' using errcode = 'P0001';
  end if;
  if (r.date_to - r.date_from) > 400 then
    raise exception 'recurring_range_too_long' using errcode = 'P0001';
  end if;

  for v_date in
    select d::date from generate_series(greatest(r.date_from, v_today), r.date_to, interval '1 day') d
    where extract(dow from d) = r.day_of_week
  loop
    perform public._lock_slot_neighbourhood(r.court_id, v_date, r.start_time, r.end_time, r.court_type::text);

    if public._slot_has_conflict(null, r.court_id, v_date, r.start_time, r.end_time, r.court_type::text, array['locked', 'booked']) then
      v_conflicts := v_conflicts || to_jsonb(v_date::text);
      continue;
    end if;

    select * into v_existing from public.slots s
    where s.court_id = r.court_id and s.slot_date = v_date and s.start_time = r.start_time and s.court_type::text = r.court_type::text;

    if found then
      if v_existing.status::text = 'blocked' then
        v_already := v_already + 1;
      else
        -- Only 'available' can reach here: locked/booked were caught above.
        update public.slots s
        set status = 'blocked', internal_reason = r.company_name, version = s.version + 1
        where s.id = v_existing.id;
        v_converted := v_converted + 1;
      end if;
    else
      insert into public.slots (court_id, slot_date, start_time, end_time, court_type, status, price_lkr, internal_reason, version)
      values (r.court_id, v_date, r.start_time, r.end_time, r.court_type, 'blocked', coalesce(r.price_lkr, 0), r.company_name, 0)
      on conflict do nothing;
      v_created := v_created + 1;
    end if;
  end loop;

  perform public.write_audit(v_uid, 'admin', 'recurring.generate', 'recurring_booking', r.id::text,
    jsonb_build_object('created', v_created, 'converted', v_converted, 'already_blocked', v_already, 'conflict_dates', v_conflicts));

  return jsonb_build_object('created', v_created, 'converted', v_converted, 'already_blocked', v_already, 'conflict_dates', v_conflicts);
end $$;
revoke all on function public.admin_generate_recurring_slots(uuid) from public, anon;
grant execute on function public.admin_generate_recurring_slots(uuid) to authenticated;
