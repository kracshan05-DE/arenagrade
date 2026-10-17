-- ArenaGrade: super_admin verification and (only if needed) safe revocation.
--
-- PART A — READ ONLY. Lists every super_admin with a masked email so you can
-- confirm each account is yours or a trusted administrator's.
select p.id,
       left(split_part(u.email, '@', 1), 2) || '***@' || split_part(u.email, '@', 2) as email_masked,
       u.created_at as account_created,
       u.last_sign_in_at,
       p.updated_at as profile_last_updated   -- a recent change may indicate self-promotion
from public.profiles p
join auth.users u on u.id = p.id
where p.role = 'super_admin'
order by u.created_at;

-- PART B — ONLY for an account you have confirmed is NOT authorised.
-- Steps (do them in this order so you never lock yourself out):
--   1. Sign in to the admin panel with YOUR account and confirm it works.
--   2. Fill in the two IDs below (yours, and the one to revoke) and run.
--   3. In Supabase -> Authentication -> Users, also sign that user out
--      ("Log out user") so any open admin session ends, and review their bookings.
--
-- begin;
-- do $$
-- declare
--   v_keep   uuid := '<YOUR_OWN_PROFILE_ID>';
--   v_revoke uuid := '<UNAUTHORISED_PROFILE_ID>';
-- begin
--   if v_keep = v_revoke then raise exception 'Refusing: same account.'; end if;
--   if not exists (select 1 from public.profiles where id = v_keep and role = 'super_admin') then
--     raise exception 'Refusing: your own account is not super_admin.';
--   end if;
--   update public.profiles set role = 'customer', updated_at = now() where id = v_revoke and role = 'super_admin';
--   if (select count(*) from public.profiles where role = 'super_admin') < 1 then
--     raise exception 'Refusing: no super_admin would remain.';
--   end if;
-- end $$;
-- commit;
--
-- After the security migrations are applied, a customer can no longer change
-- their own role; only this SQL (run as the database owner) can.
