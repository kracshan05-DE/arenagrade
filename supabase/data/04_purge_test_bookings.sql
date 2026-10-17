-- ArenaGrade: delete ALL test bookings before public launch (planned for
-- 1 November 2026, owner decision 2026-10-18).
--
-- A booking is a TEST booking when its payment attempt is not live:
--   environment 'test'    = admin test booking (no payment) or simulator
--   environment 'sandbox' = PayHere sandbox payment (no real money)
-- Live bookings are never touched. All changes happen inside ONE statement
-- (the DO block), so it is all-or-nothing, with backups. No temporary tables
-- or session state: it works in the Supabase SQL Editor.
--
-- RUN ORDER on launch day: 1) set booking to 'Paused' in the admin panel,
-- 2) run this script, 3) switch PayHere to live, 4) set booking 'Open to everyone'.

do $$
declare
  v_bookings uuid[];
  v_attempts uuid[];
  v_live integer;
  v_n integer;
begin
  select coalesce(array_agg(distinct a.booking_id), '{}'), coalesce(array_agg(a.id), '{}')
  into v_bookings, v_attempts
  from public.payment_attempts a
  join public.bookings b on b.id = a.booking_id
  where a.environment in ('test', 'sandbox');

  -- Safety: none of the targets may also have a live payment.
  select count(*) into v_live from public.payment_attempts a
  where a.environment = 'live' and a.booking_id = any (v_bookings);
  if v_live > 0 then raise exception 'Refusing: % target bookings have a live payment. Nothing changed.', v_live; end if;
  raise notice 'Test bookings to delete: %', cardinality(v_bookings);

  -- Backups (accumulate if the script is run more than once).
  create table if not exists public.purge_test_bookings_backup as select * from public.bookings where false;
  create table if not exists public.purge_test_booking_slots_backup as select * from public.booking_slots where false;
  create table if not exists public.purge_test_slots_backup as select * from public.slots where false;
  alter table public.purge_test_bookings_backup enable row level security;  -- no policies: invisible to the API
  alter table public.purge_test_booking_slots_backup enable row level security;
  alter table public.purge_test_slots_backup enable row level security;
  insert into public.purge_test_bookings_backup select b.* from public.bookings b where b.id = any (v_bookings);
  insert into public.purge_test_booking_slots_backup select bs.* from public.booking_slots bs where bs.booking_id = any (v_bookings);
  insert into public.purge_test_slots_backup select distinct s.* from public.slots s
    where s.id in (select bs.slot_id from public.booking_slots bs where bs.booking_id = any (v_bookings)
                   union select b.slot_id from public.bookings b where b.id = any (v_bookings));

  -- Free the hours (only if booked and no other live booking uses them).
  update public.slots s
  set status = 'available', locked_by = null, lock_expires_at = null, version = s.version + 1
  where s.id in (select bs.slot_id from public.booking_slots bs where bs.booking_id = any (v_bookings)
                 union select b.slot_id from public.bookings b where b.id = any (v_bookings))
    and s.status = 'booked'
    and not exists (
      select 1 from public.bookings b
      left join public.booking_slots bs on bs.booking_id = b.id
      where (b.slot_id = s.id or bs.slot_id = s.id)
        and b.status in ('confirmed', 'cancellation_requested')
        and not (b.id = any (v_bookings)));
  get diagnostics v_n = row_count;
  raise notice 'Hours set back to available: %', v_n;

  -- Test refunds and the attempts' links go first (foreign keys), then bookings.
  delete from public.refunds r where r.booking_id = any (v_bookings) or r.payment_attempt_id = any (v_attempts);
  update public.payment_attempts
  set booking_id = null, reconciliation_note = coalesce(reconciliation_note, '') || ' [test booking purged]'
  where id = any (v_attempts);
  delete from public.bookings b where b.id = any (v_bookings);  -- booking_slots cascade
  get diagnostics v_n = row_count;
  raise notice 'Deleted % test bookings', v_n;
end $$;

-- Verification (read-only). Expected: test_bookings_remaining = 0 and
-- booked_slots_without_booking = 0.
select
  (select count(*) from public.bookings b join public.payment_attempts a on a.booking_id = b.id where a.environment <> 'live') as test_bookings_remaining,
  (select count(*) from public.bookings) as bookings_remaining,
  (select count(*) from public.purge_test_bookings_backup) as bookings_in_backup,
  (select count(*) from public.slots s where s.status = 'booked'
     and not exists (select 1 from public.booking_slots bs join public.bookings b on b.id = bs.booking_id
                     where bs.slot_id = s.id and b.status in ('confirmed','cancellation_requested'))) as booked_slots_without_booking;

-- ROLLBACK (new transaction): re-insert from purge_test_bookings_backup and
-- purge_test_booking_slots_backup, restore slot statuses from
-- purge_test_slots_backup, and set payment_attempts.booking_id back.
-- Drop the three backup tables once you are satisfied.
