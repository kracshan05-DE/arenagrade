-- ArenaGrade data-integrity pre-checks — READ ONLY, COUNTS ONLY.
-- Returns aggregate numbers and slot IDs only: no names, phones, emails or OTPs.
-- These answer whether the new database constraints can be applied safely
-- (an exclusion constraint fails to create if existing rows already conflict).
-- Returns ONE JSON value. Save it as supabase/discovery/output/02_integrity_checks.json.

with s as (
  select id, court_id, slot_date, start_time, end_time, court_type::text as court_type, status::text as status,
         lock_expires_at
  from public.slots
),
-- Pairs of slots on the same court and date whose times overlap and whose court
-- parts overlap (full court uses both halves; half_a / half_b use one each).
conflicts as (
  select a.id as slot_a, b.id as slot_b, a.status as status_a, b.status as status_b
  from s a
  join s b on a.court_id = b.court_id and a.slot_date = b.slot_date and a.id < b.id
  where a.start_time < b.end_time and b.start_time < a.end_time
    and (a.court_type = 'full_court' or b.court_type = 'full_court' or a.court_type = b.court_type)
)
select jsonb_pretty(jsonb_build_object(
  'slot_status_counts', (select jsonb_object_agg(status, n) from (select status, count(*) n from s group by status) x),
  'slot_court_type_counts', (select jsonb_object_agg(court_type, n) from (select court_type, count(*) n from s group by court_type) x),
  'booking_status_counts', (select jsonb_object_agg(coalesce(status::text, 'null'), n) from (select status, count(*) n from public.bookings group by status) x),
  'slots_end_not_after_start', (select count(*) from s where end_time <= start_time),
  'slots_max_end_time', (select max(end_time)::text from s),
  'duplicate_slot_keys', (select count(*) from (select 1 from s group by court_id, slot_date, start_time, court_type having count(*) > 1) x),
  'overlapping_pairs_total', (select count(*) from conflicts),
  'overlapping_pairs_both_active', (select count(*) from conflicts
      where status_a in ('locked','booked') and status_b in ('locked','booked')),
  'overlapping_active_pair_ids_sample', (select coalesce(jsonb_agg(jsonb_build_array(slot_a, slot_b, status_a, status_b)), '[]'::jsonb)
      from (select * from conflicts where status_a in ('locked','booked','blocked') and status_b in ('locked','booked','blocked') limit 25) x),
  'expired_locks_still_locked', (select count(*) from s where status = 'locked' and lock_expires_at < now()),
  'locked_without_expiry', (select count(*) from s where status = 'locked' and lock_expires_at is null),
  'confirmed_bookings_slot_not_booked', (select count(*) from public.bookings b join s on s.id = b.slot_id
      where b.status::text = 'confirmed' and s.status <> 'booked'),
  'booked_slots_without_confirmed_booking', (select count(*) from s where s.status = 'booked'
      and not exists (select 1 from public.bookings b where b.slot_id = s.id and b.status::text in ('confirmed','cancellation_requested'))),
  'slots_with_multiple_live_bookings', (select count(*) from (select slot_id from public.bookings
      where status::text in ('confirmed','cancellation_requested') group by slot_id having count(*) > 1) x),
  'booking_amount_differs_from_slot_price', (select count(*) from public.bookings b
      join public.slots sl on sl.id = b.slot_id where b.total_lkr is distinct from sl.price_lkr),
  'bookings_without_payment_reference', (select count(*) from public.bookings where payhere_payment_id is null),
  'profiles_by_role', (select jsonb_object_agg(coalesce(role::text, 'null'), n) from (select role, count(*) n from public.profiles group by role) x),
  'profiles_phone_verified', (select count(*) from public.profiles where phone_verified is true),
  'otp_rows_total', (select count(*) from public.otp_verifications),
  'payment_audit_rows', (select count(*) from public.payment_audit),
  'payment_audit_simulated_rows', (select count(*) from public.payment_audit where raw_payload ->> 'simulated' = 'true')
)) as integrity_checks;
