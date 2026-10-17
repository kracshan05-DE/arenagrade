-- ArenaGrade: delete ALL test bookings before public launch (planned for
-- 1 November 2026, owner decision 2026-10-18).
--
-- A booking is a TEST booking when its payment attempt is not live:
--   environment 'test'    = admin test booking (no payment) or simulator
--   environment 'sandbox' = PayHere sandbox payment (no real money)
-- Live bookings are never touched. One transaction, with backups.
--
-- RUN ORDER on launch day: 1) set booking_mode to 'closed' in the admin panel,
-- 2) run this script, 3) switch PayHere to live, 4) set booking_mode 'public'.

begin;

create temp table purge_target on commit drop as
select b.id as booking_id, a.id as attempt_id, a.order_id, a.environment
from public.bookings b
join public.payment_attempts a on a.booking_id = b.id
where a.environment in ('test', 'sandbox');

do $$
declare
  v_live integer;
  v_n integer;
begin
  select count(*) into v_n from purge_target;
  -- Safety: none of the targets may also have a live payment.
  select count(*) into v_live from public.payment_attempts a
  where a.environment = 'live' and a.booking_id in (select booking_id from purge_target);
  if v_live > 0 then raise exception 'Refusing: % target bookings have a live payment.', v_live; end if;
  raise notice 'Test bookings to delete: %', v_n;
end $$;

create table if not exists public.purge_test_bookings_backup as select * from public.bookings where false;
create table if not exists public.purge_test_booking_slots_backup as select * from public.booking_slots where false;
create table if not exists public.purge_test_slots_backup as select * from public.slots where false;
insert into public.purge_test_bookings_backup select b.* from public.bookings b where b.id in (select booking_id from purge_target);
insert into public.purge_test_booking_slots_backup select bs.* from public.booking_slots bs where bs.booking_id in (select booking_id from purge_target);
insert into public.purge_test_slots_backup select distinct s.* from public.slots s
  where s.id in (select slot_id from public.purge_test_booking_slots_backup)
     or s.id in (select slot_id from public.purge_test_bookings_backup);
alter table public.purge_test_bookings_backup enable row level security;
alter table public.purge_test_booking_slots_backup enable row level security;
alter table public.purge_test_slots_backup enable row level security;

-- Free the hours (only if booked and no other live booking uses them).
update public.slots s
set status = 'available', locked_by = null, lock_expires_at = null, version = s.version + 1
where s.id in (select id from public.purge_test_slots_backup)
  and s.status = 'booked'
  and not exists (
    select 1 from public.bookings b
    left join public.booking_slots bs on bs.booking_id = b.id
    where (b.slot_id = s.id or bs.slot_id = s.id)
      and b.status in ('confirmed', 'cancellation_requested')
      and b.id not in (select booking_id from purge_target));

-- Test refunds and the attempts' links go first (foreign keys), then bookings.
delete from public.refunds r where r.booking_id in (select booking_id from purge_target)
   or r.payment_attempt_id in (select attempt_id from purge_target);
update public.payment_attempts set booking_id = null, reconciliation_note = coalesce(reconciliation_note, '') || ' [test booking purged]'
  where id in (select attempt_id from purge_target);
delete from public.bookings b where b.id in (select booking_id from purge_target);  -- booking_slots cascade

select
  (select count(*) from public.purge_test_bookings_backup) as test_bookings_deleted,
  (select count(*) from public.bookings b join public.payment_attempts a on a.booking_id = b.id where a.environment <> 'live') as test_bookings_remaining,
  (select count(*) from public.bookings) as bookings_remaining,
  (select count(*) from public.slots s where s.status = 'booked'
     and not exists (select 1 from public.booking_slots bs join public.bookings b on b.id = bs.booking_id
                     where bs.slot_id = s.id and b.status in ('confirmed','cancellation_requested'))) as booked_slots_without_booking;

commit;

-- ROLLBACK (new transaction): re-insert from purge_test_bookings_backup and
-- purge_test_booking_slots_backup, restore slot statuses from
-- purge_test_slots_backup, and set payment_attempts.booking_id back.
-- Drop the three backup tables once you are satisfied.
