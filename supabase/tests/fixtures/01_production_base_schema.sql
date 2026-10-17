-- TEST FIXTURE ONLY — mirrors the production schema as VERIFIED from
-- supabase/discovery/01_schema_metadata.sql output (2026-10-18): column types,
-- check constraints, unique indexes, the handle_new_user trigger, the original
-- is_super_admin(), and the ORIGINAL RLS policies (including the permissive
-- ones the migrations must remove). Tables not touched by the app's booking
-- flow (cities, districts, orders, order_items) are included minimally so the
-- RLS migration is tested against their presence.

create table public.districts (
  id uuid primary key default gen_random_uuid(),
  name varchar not null unique,
  created_at timestamptz default now()
);
create table public.cities (
  id uuid primary key default gen_random_uuid(),
  district_id uuid not null references public.districts(id),
  name varchar not null,
  is_active boolean default true,
  created_at timestamptz default now(),
  unique (district_id, name)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name varchar,
  phone varchar,
  phone_verified boolean default false,
  role varchar not null default 'customer' check (role in ('super_admin', 'customer')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index idx_profiles_role on public.profiles (role);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name varchar not null,
  district_id uuid references public.districts(id),
  city_id uuid references public.cities(id),
  address text,
  google_maps_url text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table public.sport_types (
  id uuid primary key default gen_random_uuid(),
  name varchar not null unique,
  has_half_court_option boolean default false,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table public.courts (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references public.locations(id),
  name varchar not null,
  sport_type_id uuid references public.sport_types(id),
  has_half_court boolean default false,
  half_court_cutoff time default '14:00:00',
  operating_start time not null default '06:00:00',
  operating_end time not null default '22:00:00',
  slot_duration_hrs integer not null default 2,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table public.court_pricing (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references public.courts(id) on delete cascade,
  tier_name varchar not null,
  time_from time not null,
  time_to time not null,
  price_lkr numeric not null check (price_lkr > 0),
  applies_to varchar not null check (applies_to in ('full_court', 'half_a', 'half_b')),
  created_at timestamptz default now()
);

create table public.slots (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references public.courts(id),
  slot_date date not null,
  start_time time not null,
  end_time time not null,
  court_type varchar not null check (court_type in ('full_court', 'half_a', 'half_b')),
  status varchar not null default 'available' check (status in ('available', 'locked', 'booked', 'blocked')),
  locked_by uuid references auth.users(id),
  lock_expires_at timestamptz,
  price_lkr numeric not null,
  version integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  internal_reason text
);
create unique index idx_slots_active on public.slots (court_id, slot_date, start_time, court_type)
  where status in ('locked', 'booked');
create index idx_slots_lock_expiry on public.slots (lock_expires_at) where status = 'locked';

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  slot_id uuid not null references public.slots(id),
  court_id uuid not null references public.courts(id),
  status varchar not null default 'confirmed' check (status in ('confirmed', 'cancellation_requested', 'cancelled')),
  total_lkr numeric not null,
  payhere_payment_id varchar,
  idempotency_key varchar unique,
  cancellation_reason text,
  cancelled_by varchar check (cancelled_by in ('customer', 'admin')),
  refund_amount_lkr numeric,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.otp_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  phone varchar not null,
  otp_code varchar not null,
  expires_at timestamptz not null,
  verified boolean default false,
  attempts integer default 0,
  created_at timestamptz default now()
);
create index idx_otp_user on public.otp_verifications (user_id, expires_at);

create table public.payment_audit (
  id uuid primary key default gen_random_uuid(),
  payhere_payment_id varchar not null,
  entity_type varchar not null check (entity_type in ('booking', 'order')),
  entity_id uuid not null,
  event_type varchar not null check (event_type in ('initiated', 'completed', 'failed', 'refunded')),
  amount_lkr numeric not null,
  raw_payload jsonb,
  created_at timestamptz default now()
);
create unique index idx_payment_idempotency on public.payment_audit (payhere_payment_id, event_type);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name varchar not null,
  description text,
  category varchar not null default 'basketball',
  price_lkr numeric not null default 1 check (price_lkr > 0),
  stock_quantity integer not null default 0,
  low_stock_threshold integer not null default 10,
  images text[] default '{}',
  is_active boolean default true,
  sku varchar unique,
  is_bulk_available boolean default false,
  bulk_min_qty integer,
  bulk_price_lkr numeric,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  status varchar not null default 'pending',
  fulfilment_type varchar not null default 'pickup',
  subtotal_lkr numeric not null default 0,
  total_lkr numeric not null default 0,
  created_at timestamptz default now()
);
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity integer not null check (quantity > 0),
  unit_price_lkr numeric not null
);

create table public.court_portfolio (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Untitled',
  location text not null default '',
  sport_type text not null default '',
  description text,
  images text[] default '{}',
  is_active boolean default true,
  created_at timestamptz default now()
);

create table public.recurring_bookings (
  id uuid primary key default gen_random_uuid(),
  court_id uuid references public.courts(id),
  company_name text not null,
  day_of_week integer not null,
  start_time time not null,
  end_time time not null,
  court_type text not null default 'full_court',
  price_lkr numeric default 0,
  date_from date not null,
  date_to date not null,
  notes text,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- Original functions (as in production).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, new.raw_user_meta_data->>'full_name', 'customer');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_super_admin() returns boolean
language sql security definer as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'super_admin');
$$;

-- ORIGINAL production policies (verified). Several are dangerously permissive;
-- the migrations must remove them.
alter table public.districts enable row level security;
alter table public.cities enable row level security;
alter table public.profiles enable row level security;
alter table public.locations enable row level security;
alter table public.sport_types enable row level security;
alter table public.courts enable row level security;
alter table public.court_pricing enable row level security;
alter table public.slots enable row level security;
alter table public.bookings enable row level security;
alter table public.otp_verifications enable row level security;
alter table public.payment_audit enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.court_portfolio enable row level security;
alter table public.recurring_bookings enable row level security;

create policy public_read_districts on public.districts for select using (true);
create policy public_read_cities on public.cities for select using (is_active = true);

create policy customers_read_own_profile on public.profiles for select using (auth.uid() = id);
create policy customers_update_own_profile on public.profiles for update using (auth.uid() = id);
create policy super_admin_read_all_profiles on public.profiles for select using ((auth.uid() = id) or is_super_admin());
create policy users_update_own_profile on public.profiles for update using (auth.uid() = id);

create policy public_read_locations on public.locations for select using (is_active = true);
create policy super_admin_manage_locations on public.locations for all
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'super_admin'));
create policy public_read_sport_types on public.sport_types for select using (is_active = true);
create policy public_read_courts on public.courts for select using (is_active = true);
create policy super_admin_manage_courts on public.courts for all
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'super_admin'));
create policy public_read_pricing on public.court_pricing for select using (true);
create policy super_admin_manage_pricing on public.court_pricing for all
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'super_admin'));

create policy authenticated_users_can_lock_slots on public.slots for update
  using ((auth.uid() is not null) and (status = 'available')) with check (auth.uid() is not null);
create policy customers_update_locked_slots on public.slots for update
  using ((auth.uid() = locked_by) and (status = 'locked'));
create policy public_read_slots on public.slots for select using (true);
create policy super_admin_read_all_slots on public.slots for all
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'super_admin'));

create policy customers_insert_own_bookings on public.bookings for insert with check (auth.uid() = user_id);
create policy customers_read_own_bookings on public.bookings for select using (auth.uid() = user_id);
create policy customers_update_own_bookings on public.bookings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy super_admin_read_all_bookings on public.bookings for all
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'super_admin'));

create policy customers_read_own_otp on public.otp_verifications for select using (auth.uid() = user_id);
create policy users_insert_own_otp on public.otp_verifications for insert with check (auth.uid() = user_id);
create policy users_read_own_otp on public.otp_verifications for select using (auth.uid() = user_id);
create policy users_update_own_otp on public.otp_verifications for update using (auth.uid() = user_id);

create policy public_read_products on public.products for select using (is_active = true);
create policy super_admin_manage_products on public.products for all
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'super_admin'));
create policy customers_read_own_orders on public.orders for select using (auth.uid() = user_id);
create policy customers_read_own_order_items on public.order_items for select
  using (exists (select 1 from orders where orders.id = order_items.order_id and orders.user_id = auth.uid()));
create policy public_read_portfolio on public.court_portfolio for select using (is_active = true);
create policy admin_manage_portfolio on public.court_portfolio for all
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'super_admin'));
create policy admin_manage_recurring on public.recurring_bookings for all
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'super_admin'));

-- Production storage policies (already correct; the migrations leave them).
create policy public_read_images on storage.objects for select using (bucket_id = 'images');
create policy admin_upload_images on storage.objects for insert
  with check (bucket_id = 'images' and exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'super_admin'));
create policy admin_delete_images on storage.objects for delete
  using (bucket_id = 'images' and exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'super_admin'));
