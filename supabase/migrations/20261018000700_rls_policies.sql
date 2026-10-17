-- ArenaGrade production-readiness: Row Level Security and grants.
--
-- !! REVIEW BEFORE APPLYING !!
-- This migration DROPS every existing policy on the ArenaGrade public tables
-- listed below and replaces them with the set defined here. Compare with the
-- "policies" section of supabase/discovery/01_schema_metadata.json first.
-- Storage policies are ADDED, not dropped: remove any older permissive
-- storage.objects policies by hand after reviewing the discovery output.
--
-- Model:
--   * anon + authenticated may READ public catalogue data (courts, slots, ...)
--   * customers read only their own bookings / payments / refunds / profile
--   * customers write NOTHING directly except their own profile name fields;
--     holds, cancellations and payments go through checked functions
--   * admins (profiles.role = 'super_admin') manage catalogue tables and read
--     operational tables; booking/refund state changes still go through
--     functions so rules and audit logging cannot be skipped
--   * service_role (server only) bypasses RLS

do $$
declare
  t text;
  p record;
begin
  foreach t in array array[
    'profiles', 'locations', 'sport_types', 'courts', 'court_pricing', 'slots', 'bookings',
    'otp_verifications', 'payment_audit', 'products', 'court_portfolio', 'recurring_bookings',
    'audit_log', 'app_events', 'rate_limits', 'phone_otp_challenges', 'payment_attempts',
    'payment_events', 'refunds', 'notification_log', 'job_runs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
  end loop;
end $$;

-- Catalogue tables: public read, admin write.
do $$
declare
  t text;
begin
  foreach t in array array['locations', 'sport_types', 'courts', 'court_pricing', 'products', 'court_portfolio'] loop
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_public_read', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.is_super_admin())) with check ((select public.is_super_admin()))', t || '_admin_write', t);
  end loop;
end $$;

-- Slots: public read (availability). Admins may insert/delete/update for slot
-- generation and maintenance; customer holds use hold_slot()/release_hold().
create policy slots_public_read on public.slots for select to anon, authenticated using (true);
create policy slots_admin_insert on public.slots for insert to authenticated with check ((select public.is_super_admin()));
create policy slots_admin_update on public.slots for update to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));
create policy slots_admin_delete on public.slots for delete to authenticated
  using ((select public.is_super_admin()) and status::text in ('available', 'blocked'));

-- Recurring bookings: admin only (contains company names).
create policy recurring_admin_all on public.recurring_bookings for all to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));

-- Profiles: own row or admin. Updates limited further by the
-- profiles_guard_privileged_columns trigger (role/phone/phone_verified).
create policy profiles_read_own_or_admin on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_super_admin()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Bookings, payment attempts, refunds: own rows or admin, read only.
create policy bookings_read_own_or_admin on public.bookings for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_super_admin()));
create policy payment_attempts_read_own_or_admin on public.payment_attempts for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_super_admin()));
create policy refunds_read_own_or_admin on public.refunds for select to authenticated
  using ((select public.is_super_admin())
         or exists (select 1 from public.bookings b where b.id = refunds.booking_id and b.user_id = (select auth.uid()))
         or exists (select 1 from public.payment_attempts a where a.id = refunds.payment_attempt_id and a.user_id = (select auth.uid())));

-- Operational tables: admin read only.
create policy payment_audit_admin_read on public.payment_audit for select to authenticated using ((select public.is_super_admin()));
create policy payment_events_admin_read on public.payment_events for select to authenticated using ((select public.is_super_admin()));
create policy audit_log_admin_read on public.audit_log for select to authenticated using ((select public.is_super_admin()));
create policy app_events_admin_read on public.app_events for select to authenticated using ((select public.is_super_admin()));
create policy notification_log_admin_read on public.notification_log for select to authenticated using ((select public.is_super_admin()));
create policy job_runs_admin_read on public.job_runs for select to authenticated using ((select public.is_super_admin()));
-- otp_verifications, phone_otp_challenges, rate_limits: no policies (server only).

-- Grants as a second layer: remove write privileges the browser never needs.
revoke insert, update, delete, truncate on
  public.bookings, public.payment_attempts, public.payment_events, public.refunds, public.payment_audit,
  public.audit_log, public.app_events, public.notification_log, public.job_runs, public.rate_limits,
  public.otp_verifications, public.phone_otp_challenges
from anon, authenticated;
revoke all on public.otp_verifications, public.phone_otp_challenges, public.rate_limits from anon, authenticated;
revoke insert, update, delete, truncate on
  public.slots, public.courts, public.court_pricing, public.locations, public.sport_types,
  public.products, public.court_portfolio, public.recurring_bookings, public.profiles
from anon;
revoke insert, delete, truncate on public.profiles from authenticated;

-- Storage: images bucket — public read, admin write.
drop policy if exists arenagrade_images_public_read on storage.objects;
drop policy if exists arenagrade_images_admin_insert on storage.objects;
drop policy if exists arenagrade_images_admin_update on storage.objects;
drop policy if exists arenagrade_images_admin_delete on storage.objects;
create policy arenagrade_images_public_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'images');
create policy arenagrade_images_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'images' and (select public.is_super_admin()));
create policy arenagrade_images_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'images' and (select public.is_super_admin()))
  with check (bucket_id = 'images' and (select public.is_super_admin()));
create policy arenagrade_images_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'images' and (select public.is_super_admin()));

-- Internal helper functions must never be callable through the API.
revoke all on function public._lock_slot_neighbourhood(uuid, date, time, time, text) from public, anon, authenticated, service_role;
revoke all on function public._slot_has_conflict(uuid, uuid, date, time, time, text, text[]) from public, anon, authenticated, service_role;
revoke all on function public._booking_notice(uuid) from public, anon, authenticated, service_role;
