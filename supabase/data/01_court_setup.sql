-- ArenaGrade: official court configuration and prices (owner-approved
-- 2026-10-18). Run AFTER the migrations in supabase/migrations.
--
--   St. Mary's Basketball Court : full court LKR 6,000/hour, half court LKR 3,000/hour,
--                                 existing hours, slot length and half-court cut-off KEPT
--   The Solo Court              : separate half-sized court, LKR 2,500/hour, 05:00–22:00,
--                                 1-hour slots (17 per day), book 1 or 2 consecutive hours
--
-- One transaction; stops on the first failed check. It does NOT create courts
-- (to avoid duplicates) and never changes booked or held slots.

begin;

do $$
declare
  -- >>> REPLACE with the court IDs from the data inventory <<<
  v_st_marys uuid := '00000000-0000-0000-0000-000000000001';
  v_solo     uuid := '00000000-0000-0000-0000-000000000002';
  v_days     integer := 60;   -- how far ahead to generate Solo Court slots
  v_today date := (now() at time zone 'Asia/Colombo')::date;
  v_n integer;
  v_r jsonb;
begin
  if v_st_marys = v_solo then raise exception 'St. Mary''s and The Solo Court must be different court records.'; end if;
  if not exists (select 1 from public.courts where id = v_st_marys) then raise exception 'St. Mary''s court id not found.'; end if;
  if not exists (select 1 from public.courts where id = v_solo) then raise exception 'Solo Court id not found. Create it once in the admin panel, then rerun.'; end if;
  if not (select coalesce(has_half_court, false) from public.courts where id = v_st_marys) then
    raise exception 'St. Mary''s does not have half courts enabled. Check the id before continuing.';
  end if;

  -- The Solo Court: own rules, no halves, 1-hour slots, 1–2 consecutive hours.
  update public.courts
  set name = 'The Solo Court', has_half_court = false, operating_start = '05:00', operating_end = '22:00',
      slot_duration_hrs = 1, max_consecutive_slots = 2, is_active = true
  where id = v_solo;
  -- St. Mary's: one slot per booking (hours, slot length and cut-off unchanged).
  update public.courts set max_consecutive_slots = 1 where id = v_st_marys;

  -- Prices are PER HOUR, all day.
  delete from public.court_pricing where court_id in (v_st_marys, v_solo);
  insert into public.court_pricing (court_id, tier_name, time_from, time_to, price_lkr, applies_to) values
    (v_st_marys, 'Standard', '00:00', '00:00', 6000, 'full_court'),
    (v_st_marys, 'Standard', '00:00', '00:00', 3000, 'half_a'),
    (v_st_marys, 'Standard', '00:00', '00:00', 3000, 'half_b'),
    (v_solo,     'Standard', '00:00', '00:00', 2500, 'full_court');

  -- Solo Court: remove FUTURE, UNUSED slots that do not fit its new layout
  -- (half-court rows, or slots that are not exactly 1 hour). Booked/held/
  -- blocked rows are kept and reported.
  delete from public.slots s
  where s.court_id = v_solo and s.slot_date >= v_today and s.status = 'available'
    and not exists (select 1 from public.bookings b where b.slot_id = s.id)
    and not exists (select 1 from public.booking_slots bs where bs.slot_id = s.id)
    and (s.court_type <> 'full_court' or public.slot_hours(s.start_time, s.end_time) <> 1
         or s.start_time < '05:00' or s.end_time > '22:00' or s.end_time = '00:00');
  get diagnostics v_n = row_count;
  raise notice 'Solo Court: removed % future unused slots that did not fit the 1-hour layout', v_n;

  select count(*) into v_n from public.slots s
  where s.court_id = v_solo and s.slot_date >= v_today and s.status <> 'available'
    and (s.court_type <> 'full_court' or public.slot_hours(s.start_time, s.end_time) <> 1);
  if v_n > 0 then raise notice 'Solo Court: % future booked/held/blocked slots do not fit the new layout — review manually', v_n; end if;

  -- Reprice FUTURE slots that are not booked or held: hourly price x hours.
  update public.slots s
  set price_lkr = round(public.court_hourly_price(s.court_id, s.court_type, s.start_time) * public.slot_hours(s.start_time, s.end_time), 2)
  where s.court_id in (v_st_marys, v_solo) and s.slot_date >= v_today and s.status in ('available', 'blocked')
    and public.court_hourly_price(s.court_id, s.court_type, s.start_time) is not null;
  get diagnostics v_n = row_count;
  raise notice 'Repriced % future available/blocked slots', v_n;

  -- Generate the Solo Court schedule (idempotent: only missing slots are added).
  v_r := public._generate_court_slots(v_solo, v_today, v_today + v_days);
  raise notice 'Solo Court generation: %', v_r;
end $$;

-- Verification (review before COMMIT):
select c.name, c.is_active, c.has_half_court, c.operating_start, c.operating_end, c.slot_duration_hrs, c.max_consecutive_slots,
       (select string_agg(p.applies_to || ' ' || p.price_lkr || '/h', ', ' order by p.applies_to) from public.court_pricing p where p.court_id = c.id) as prices,
       (select count(*) from public.slots s where s.court_id = c.id and s.slot_date = (now() at time zone 'Asia/Colombo')::date + 1 and s.court_type = 'full_court') as full_slots_tomorrow,
       (select string_agg(distinct s.price_lkr::text, ', ') from public.slots s where s.court_id = c.id and s.slot_date > (now() at time zone 'Asia/Colombo')::date and s.court_type = 'full_court') as future_full_prices
from public.courts c
order by c.name;

commit;

-- ROLLBACK: prices and court settings are plain values — restore them from the
-- data inventory output (pricing_tiers, operating hours) with UPDATE/INSERT.
-- Deleted Solo slots were unused future rows; re-running generation recreates them.
