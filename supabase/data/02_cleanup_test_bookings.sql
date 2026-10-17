-- ArenaGrade: remove the owner's test bookings made with the old
-- "Simulate Payment" button. Authorised by the owner on 2026-10-18.
--
-- SAFE BY DESIGN
--   * All changes happen inside ONE statement (the DO block below), so it is
--     all-or-nothing: any failed check or error undoes everything. It needs no
--     temporary tables or session state, so it works in the Supabase SQL Editor.
--   * Only touches the booking IDs listed below (from the data inventory).
--   * Refuses to run if any listed booking has a real payment attempt, a
--     refund, or is not 'confirmed'; or if the list does not match exactly.
--     Running it a second time is refused (the bookings are already gone).
--   * Copies every affected row to backup tables first (rollback below).
--   * Resets a slot to 'available' ONLY if it is 'booked' and has no other live
--     booking. Blocked slots, courts, prices, users and all other slots are
--     untouched. Nothing is truncated.
--
-- HOW TO RUN: Supabase SQL Editor -> paste the whole file -> Run. Then read
-- the result of the final SELECT (it only reads).

do $$
declare
  -- The 7 simulate-button test bookings from the 2026-10-18 data inventory
  -- (all "AG-…" references; owner confirmed they are his own tests).
  v_ids constant uuid[] := array[
    '1d3c3985-b1a6-448c-b581-8ec0aa9971e1',  -- 2026-07-27 07:00 half_a
    'c57b1adc-7c3c-45c3-a6a6-7fbbb2a602d2',  -- 2026-07-27 15:00 full
    '117fb805-ebbc-4d19-9129-1cc0afb1fe67',  -- 2026-07-29 11:00 full
    '6b73b7b2-628b-4030-8fea-7415a8a10671',  -- 2026-07-29 07:00 full
    '443cdda8-ee0f-4da2-a523-e8c8941799c2',  -- 2026-08-13 09:00 half_a (overlaps the CompanyA full-court block)
    '5aa658d5-7355-4e4e-815c-d0c21dd10ea4',  -- 2026-09-08 07:00 half_a
    '828bb68a-b4cf-4797-a0b5-f97dbdef1577'   -- 2026-09-08 11:00 full
  ]::uuid[];
  v_expected constant integer := 7;  -- owner confirmed: exactly 7 test bookings
  v_found integer;
  v_bad integer;
  v_n integer;
begin
  -- 1. Safety checks (nothing has changed yet).
  if cardinality(v_ids) <> v_expected or (select count(distinct x) from unnest(v_ids) x) <> v_expected then
    raise exception 'The list must contain exactly % different booking IDs. Nothing changed.', v_expected;
  end if;

  select count(*) into v_found from public.bookings b where b.id = any (v_ids);
  if v_found <> v_expected then
    raise exception 'Expected % listed bookings, found % in the table (already cleaned up?). Nothing changed.', v_expected, v_found;
  end if;

  select count(*) into v_bad from public.bookings b where b.id = any (v_ids) and b.status <> 'confirmed';
  if v_bad > 0 then raise exception '% listed bookings are not confirmed. Nothing changed.', v_bad; end if;

  -- Real payments create payment_attempts rows; test bookings have none.
  if to_regclass('public.payment_attempts') is not null then
    execute 'select count(*) from public.payment_attempts a where a.booking_id = any ($1)' into v_bad using v_ids;
    if v_bad > 0 then raise exception '% listed bookings have a recorded payment attempt. Nothing changed.', v_bad; end if;
  end if;
  if to_regclass('public.refunds') is not null then
    execute 'select count(*) from public.refunds r where r.booking_id = any ($1)' into v_bad using v_ids;
    if v_bad > 0 then raise exception '% listed bookings have refund records. Nothing changed.', v_bad; end if;
  end if;

  -- 2. Backups (kept until you drop them; see ROLLBACK below).
  create table if not exists public.cleanup_20261018_bookings as select * from public.bookings where false;
  create table if not exists public.cleanup_20261018_slots as select * from public.slots where false;
  alter table public.cleanup_20261018_bookings enable row level security;  -- no policies: invisible to the API
  alter table public.cleanup_20261018_slots enable row level security;
  insert into public.cleanup_20261018_bookings select b.* from public.bookings b where b.id = any (v_ids);
  -- The old flow only ever created single-slot bookings, so bookings.slot_id is
  -- every affected slot (works before and after the migrations).
  insert into public.cleanup_20261018_slots
    select s.* from public.slots s
    where s.id in (select b.slot_id from public.bookings b where b.id = any (v_ids))
      and not exists (select 1 from public.cleanup_20261018_slots c where c.id = s.id);

  -- 3. Free each affected slot, only when it is safe to do so.
  update public.slots s
  set status = 'available', locked_by = null, lock_expires_at = null, version = s.version + 1
  where s.id in (select b.slot_id from public.bookings b where b.id = any (v_ids))
    and s.status = 'booked'
    and not exists (
      select 1 from public.bookings b
      where b.slot_id = s.id and b.status in ('confirmed', 'cancellation_requested')
        and not (b.id = any (v_ids)));
  get diagnostics v_n = row_count;
  raise notice 'Slots set back to available: %', v_n;

  -- 4. Delete the bookings (booking_slots rows, if the migrations are applied,
  --    go with them through ON DELETE CASCADE).
  delete from public.bookings b where b.id = any (v_ids);
  get diagnostics v_n = row_count;
  if v_n <> v_expected then
    raise exception 'Deleted % bookings instead of %. Everything was undone.', v_n, v_expected;
  end if;
  raise notice 'Deleted % test bookings', v_n;
end $$;

-- Verification (read-only). Expected after a successful run:
--   listed_bookings_remaining = 0, bookings_backed_up = 7,
--   booked_slots_without_booking = 0.
select
  (select count(*) from public.bookings where id = any (array[
     '1d3c3985-b1a6-448c-b581-8ec0aa9971e1', 'c57b1adc-7c3c-45c3-a6a6-7fbbb2a602d2',
     '117fb805-ebbc-4d19-9129-1cc0afb1fe67', '6b73b7b2-628b-4030-8fea-7415a8a10671',
     '443cdda8-ee0f-4da2-a523-e8c8941799c2', '5aa658d5-7355-4e4e-815c-d0c21dd10ea4',
     '828bb68a-b4cf-4797-a0b5-f97dbdef1577']::uuid[])) as listed_bookings_remaining,
  (select count(*) from public.bookings) as bookings_remaining,
  (select count(*) from public.cleanup_20261018_bookings) as bookings_backed_up,
  (select count(*) from public.slots where id in (select id from public.cleanup_20261018_slots) and status = 'available') as slots_now_available,
  (select count(*) from public.slots where id in (select id from public.cleanup_20261018_slots) and status <> 'available') as slots_left_as_is,
  (select count(*) from public.slots s where s.status = 'booked'
     and not exists (select 1 from public.bookings b where b.slot_id = s.id and b.status in ('confirmed','cancellation_requested'))) as booked_slots_without_booking;

-- ROLLBACK (only if needed):
--   begin;
--   insert into public.bookings select * from public.cleanup_20261018_bookings on conflict (id) do nothing;
--   update public.slots s set status = c.status, locked_by = c.locked_by, lock_expires_at = c.lock_expires_at
--     from public.cleanup_20261018_slots c where c.id = s.id;
--   -- after migrations: insert into public.booking_slots select id, slot_id from public.cleanup_20261018_bookings on conflict do nothing;
--   commit;
-- When satisfied (e.g. after launch):  drop table public.cleanup_20261018_bookings, public.cleanup_20261018_slots;
