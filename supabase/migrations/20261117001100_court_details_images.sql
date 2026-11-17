-- ArenaGrade 1100: court details, court photos, venue map links, safe court
-- deletion and an audit trail for catalogue edits (owner decision 2026-11-17).
--
--   1. courts.description and courts.images (public URLs in the "images"
--      storage bucket under courts/<court id>/, first = cover photo, max 6).
--   2. locations.google_maps_url already exists in production but was unused;
--      new values must now be a Google Maps link (NOT VALID: existing rows are
--      left as they are).
--   3. admin_delete_court(): removes a court only if it has never had a
--      booking, payment attempt or recurring booking. Its unbooked slots,
--      prices and full-court-only dates are removed with it. Otherwise the
--      admin is told to deactivate the court instead.
--   4. Every insert, update and delete on courts, court_pricing and locations
--      is written to audit_log (who, what changed).
--   5. The "images" bucket: 5 MB per file, JPEG/PNG/WebP only (matches what
--      the admin upload screens already promise).
--
-- Safe to re-run: every statement is idempotent. Depends on 0100-1000.

-- ---------------------------------------------------------------------------
-- 1. Court description and photos
-- ---------------------------------------------------------------------------
alter table public.courts add column if not exists description text;
alter table public.courts add column if not exists images text[] not null default '{}';

-- A photo must be a public object in our own images bucket, in this court's
-- folder. Stops an admin form (or a bug) from pointing the site at an
-- arbitrary external image.
create or replace function public.court_images_valid(p_court_id uuid, p_images text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(cardinality(p_images), 0) <= 6
     and not exists (
       select 1 from unnest(coalesce(p_images, '{}')) u
       where u !~ ('^https://[A-Za-z0-9.-]+/storage/v1/object/public/images/courts/'
                   || p_court_id::text || '/[A-Za-z0-9._-]{1,120}$')
     )
$$;
-- Pure validation. Signed-in roles need EXECUTE because PostgreSQL checks it
-- when the CHECK constraint runs for the admin's update; anon never writes.
revoke all on function public.court_images_valid(uuid, text[]) from public, anon;
grant execute on function public.court_images_valid(uuid, text[]) to authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'courts_description_length') then
    alter table public.courts add constraint courts_description_length
      check (description is null or char_length(description) <= 2000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'courts_images_valid') then
    alter table public.courts add constraint courts_images_valid
      check (public.court_images_valid(id, images));
  end if;
end $$;

comment on column public.courts.description is 'Customer-facing description, at most 2000 characters.';
comment on column public.courts.images is
  'Public URLs in the images bucket under courts/<court id>/. First = cover photo. At most 6.';

-- ---------------------------------------------------------------------------
-- 2. Venue map link (column already exists in production)
-- ---------------------------------------------------------------------------
alter table public.locations add column if not exists google_maps_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'locations_google_maps_url_valid') then
    alter table public.locations add constraint locations_google_maps_url_valid check (
      google_maps_url is null
      or (char_length(google_maps_url) <= 500
          and google_maps_url ~ '^https://(www\.google\.[a-z.]{2,10}/maps|maps\.google\.[a-z.]{2,10}|maps\.app\.goo\.gl|goo\.gl/maps)([/?#]|$)')
    ) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Safe court deletion
-- Errors: forbidden, court_not_found, court_in_use
-- Returns the deleted court's photo URLs so the admin screen can remove the
-- files from storage.
-- ---------------------------------------------------------------------------
create or replace function public.admin_delete_court(p_court_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.courts%rowtype;
  v_slots integer;
begin
  if not public.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into c from public.courts x where x.id = p_court_id for update;
  if not found then
    raise exception 'court_not_found' using errcode = 'P0002';
  end if;

  -- Any history at all keeps the court (deactivate it instead).
  if exists (select 1 from public.bookings b where b.court_id = p_court_id)
     or exists (select 1 from public.payment_attempts a where a.court_id = p_court_id)
     or exists (select 1 from public.recurring_bookings r where r.court_id = p_court_id)
     or exists (select 1 from public.slots s where s.court_id = p_court_id and s.status::text in ('locked', 'booked')) then
    raise exception 'court_in_use' using errcode = 'P0001',
      hint = 'This court has bookings or payment history. Deactivate it instead.';
  end if;

  delete from public.slots s where s.court_id = p_court_id;
  get diagnostics v_slots = row_count;
  delete from public.courts x where x.id = p_court_id;   -- prices and full-court dates cascade

  perform public.write_audit(auth.uid(), 'admin', 'court.delete', 'court', p_court_id::text,
    jsonb_build_object('name', c.name, 'slots_removed', v_slots, 'images', to_jsonb(c.images)));

  return jsonb_build_object('deleted', true, 'slots_removed', v_slots, 'images', to_jsonb(c.images));
end $$;
revoke all on function public.admin_delete_court(uuid) from public, anon;
grant execute on function public.admin_delete_court(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Audit trail for catalogue edits (courts, court_pricing, locations)
-- Records only the columns that changed. Runs for every writer, including
-- the admin screens' direct table updates.
-- ---------------------------------------------------------------------------
create or replace function public.audit_catalogue_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else '{}'::jsonb end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else '{}'::jsonb end;
  v_changes jsonb;
  v_uid uuid := auth.uid();
begin
  select coalesce(jsonb_object_agg(k, jsonb_build_object('from', v_old -> k, 'to', v_new -> k)), '{}'::jsonb)
    into v_changes
  from (select jsonb_object_keys(v_old || v_new) k) keys
  where (v_old -> k) is distinct from (v_new -> k);

  if tg_op = 'UPDATE' and v_changes = '{}'::jsonb then
    return null;
  end if;

  perform public.write_audit(v_uid, case when v_uid is null then 'system' else 'admin' end,
    tg_table_name || '.' || lower(tg_op), tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id'), v_changes);
  return null;
end $$;
revoke all on function public.audit_catalogue_change() from public, anon, authenticated;

drop trigger if exists courts_audit on public.courts;
create trigger courts_audit after insert or update or delete on public.courts
  for each row execute function public.audit_catalogue_change();
drop trigger if exists court_pricing_audit on public.court_pricing;
create trigger court_pricing_audit after insert or update or delete on public.court_pricing
  for each row execute function public.audit_catalogue_change();
drop trigger if exists locations_audit on public.locations;
create trigger locations_audit after insert or update or delete on public.locations
  for each row execute function public.audit_catalogue_change();

-- ---------------------------------------------------------------------------
-- 5. Storage limits on the images bucket (all admin uploads: courts,
--    products, portfolio). Existing files are not affected.
-- ---------------------------------------------------------------------------
update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'images';
