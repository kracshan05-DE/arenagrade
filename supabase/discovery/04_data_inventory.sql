-- ArenaGrade data inventory — READ ONLY. Returns ONE JSON value.
-- Needed for: court setup (St. Mary's / The Solo Court), pricing, the 7 test
-- bookings, super_admin verification and the reported block/booking overlap.
-- Personal data is minimised: emails are masked, no phone numbers or OTPs.

with
mask as (
  select u.id,
         left(split_part(u.email, '@', 1), 2) || '***@' || split_part(u.email, '@', 2) as email_masked,
         u.created_at, u.last_sign_in_at
  from auth.users u
),
court_slots as (
  select s.court_id,
         count(*) as slots_total,
         count(*) filter (where s.slot_date >= (now() at time zone 'Asia/Colombo')::date) as future_slots,
         min(s.slot_date) as first_date, max(s.slot_date) as last_date,
         (select jsonb_object_agg(st, n) from (select status st, count(*) n from public.slots x where x.court_id = s.court_id group by 1) z) as by_status,
         (select jsonb_object_agg(ct, n) from (select court_type ct, count(*) n from public.slots x where x.court_id = s.court_id group by 1) z) as by_type,
         (select jsonb_object_agg(k, n) from (
            select court_type || ' @ ' || price_lkr::text || ' LKR / ' ||
                   round(extract(epoch from (end_time - start_time)) / 3600, 2)::text || 'h' as k, count(*) n
            from public.slots x where x.court_id = s.court_id and x.slot_date >= (now() at time zone 'Asia/Colombo')::date
            group by 1) z) as future_prices
  from public.slots s
  group by s.court_id
)
select jsonb_pretty(jsonb_build_object(
  'courts', (select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'is_active', c.is_active, 'has_half_court', c.has_half_court,
      'half_court_cutoff', c.half_court_cutoff, 'operating_start', c.operating_start, 'operating_end', c.operating_end,
      'slot_duration_hrs', c.slot_duration_hrs, 'location', l.name, 'location_active', l.is_active,
      'sport', st.name, 'sport_active', st.is_active,
      'pricing_tiers', (select jsonb_agg(jsonb_build_object('tier', p.tier_name, 'from', p.time_from, 'to', p.time_to,
                          'price_lkr', p.price_lkr, 'applies_to', p.applies_to) order by p.applies_to, p.time_from)
                        from public.court_pricing p where p.court_id = c.id),
      'slots', (select to_jsonb(cs) - 'court_id' from court_slots cs where cs.court_id = c.id)
    ) order by c.name)
    from public.courts c
    left join public.locations l on l.id = c.location_id
    left join public.sport_types st on st.id = c.sport_type_id),
  'bookings', (select jsonb_agg(jsonb_build_object(
      'id', b.id, 'created_at', b.created_at, 'status', b.status, 'total_lkr', b.total_lkr,
      'payhere_payment_id', b.payhere_payment_id, 'idempotency_key', b.idempotency_key,
      'user_id', b.user_id, 'user_email_masked', m.email_masked, 'user_role', p.role,
      'court', c.name, 'slot_id', b.slot_id, 'slot_date', s.slot_date, 'start', s.start_time, 'end', s.end_time,
      'court_type', s.court_type, 'slot_status', s.status, 'slot_price', s.price_lkr
    ) order by b.created_at)
    from public.bookings b
    left join public.slots s on s.id = b.slot_id
    left join public.courts c on c.id = b.court_id
    left join public.profiles p on p.id = b.user_id
    left join mask m on m.id = b.user_id),
  'super_admins', (select jsonb_agg(jsonb_build_object(
      'id', p.id, 'email_masked', m.email_masked, 'full_name_initials',
      regexp_replace(coalesce(p.full_name, ''), '(\w)\w*\s*', '\1', 'g'),
      'account_created', m.created_at, 'last_sign_in', m.last_sign_in_at, 'profile_updated', p.updated_at
    ) order by m.created_at)
    from public.profiles p join mask m on m.id = p.id where p.role = 'super_admin'),
  'reported_overlap', (select jsonb_agg(jsonb_build_object(
      'id', s.id, 'court', c.name, 'slot_date', s.slot_date, 'start', s.start_time, 'end', s.end_time,
      'court_type', s.court_type, 'status', s.status, 'internal_reason', s.internal_reason, 'created_at', s.created_at,
      'booking_ids', (select jsonb_agg(b.id) from public.bookings b where b.slot_id = s.id)
    ))
    from public.slots s join public.courts c on c.id = s.court_id
    where s.id in ('28e73225-2746-44a5-a23b-9b103614545e', '40c2fb9f-4354-4376-a7b3-a09f906f0f76')),
  'all_block_booking_overlaps', (select jsonb_agg(jsonb_build_array(a.id, a.court_type, a.status, b.id, b.court_type, b.status, a.slot_date, a.start_time))
    from public.slots a join public.slots b
      on a.court_id = b.court_id and a.slot_date = b.slot_date and a.id <> b.id
     and a.start_time < b.end_time and b.start_time < a.end_time
     and (a.court_type = 'full_court' or b.court_type = 'full_court' or a.court_type = b.court_type)
    where a.status = 'blocked' and b.status in ('booked', 'locked')),
  'recurring_bookings', (select jsonb_agg(jsonb_build_object('id', r.id, 'court_id', r.court_id, 'day_of_week', r.day_of_week,
      'start', r.start_time, 'end', r.end_time, 'court_type', r.court_type, 'from', r.date_from, 'to', r.date_to, 'active', r.is_active))
    from public.recurring_bookings r)
)) as data_inventory;
