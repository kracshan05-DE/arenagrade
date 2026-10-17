-- TEST FIXTURE ONLY — INFERRED, NOT VERIFIED.
--
-- The real ArenaGrade schema is not in Git. This file reconstructs the tables
-- from the columns the application code reads and writes (select/insert/update
-- payloads in app/**). Column TYPES are assumptions where the code does not
-- prove them (e.g. slot_date as date, start_time as time, status as text).
--
-- It exists only so the migrations in supabase/migrations can be tested on a
-- local PostgreSQL. Before applying any migration to Supabase, compare this
-- file with the output of supabase/discovery/01_schema_metadata.sql and fix
-- the migrations wherever the real schema differs.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  phone_verified boolean not null default false,
  role text not null default 'customer',
  created_at timestamptz not null default now()
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  district text,
  city text,
  is_active boolean not null default true
);

create table public.sport_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true
);

create table public.courts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location_id uuid references public.locations(id),
  sport_type_id uuid references public.sport_types(id),
  has_half_court boolean not null default false,
  half_court_cutoff time not null default '14:00',
  operating_start time not null default '06:00',
  operating_end time not null default '22:00',
  slot_duration_hrs integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.court_pricing (
  id uuid primary key default gen_random_uuid(),
  court_id uuid references public.courts(id) on delete cascade,
  tier_name text,
  time_from time,
  time_to time,
  price_lkr numeric(12,2),
  applies_to text
);

create table public.slots (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references public.courts(id) on delete cascade,
  slot_date date not null,
  start_time time not null,
  end_time time not null,
  court_type text not null,
  status text not null default 'available',
  price_lkr numeric(12,2) not null default 0,
  locked_by uuid references auth.users(id),
  lock_expires_at timestamptz,
  version integer not null default 0,
  internal_reason text,
  created_at timestamptz not null default now(),
  constraint slots_court_id_slot_date_start_time_court_type_key unique (court_id, slot_date, start_time, court_type)
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  slot_id uuid references public.slots(id),
  court_id uuid references public.courts(id),
  status text not null default 'confirmed',
  total_lkr numeric(12,2) not null default 0,
  payhere_payment_id text,
  idempotency_key text,
  cancellation_reason text,
  refund_amount_lkr numeric(12,2),
  cancelled_by text,
  created_at timestamptz not null default now()
);

create table public.otp_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  phone text not null,
  otp_code text not null,
  expires_at timestamptz not null,
  verified boolean not null default false,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.payment_audit (
  id uuid primary key default gen_random_uuid(),
  payhere_payment_id text,
  entity_type text,
  entity_id uuid,
  event_type text,
  amount_lkr numeric(12,2),
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  category text,
  price_lkr numeric(12,2),
  stock_quantity integer not null default 0,
  low_stock_threshold integer,
  is_active boolean not null default true,
  sku text,
  is_bulk_available boolean default false,
  bulk_min_qty integer,
  bulk_price_lkr numeric(12,2),
  images text[] default '{}',
  created_at timestamptz not null default now()
);

create table public.court_portfolio (
  id uuid primary key default gen_random_uuid(),
  title text,
  location text,
  sport_type text,
  description text,
  images text[] default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.recurring_bookings (
  id uuid primary key default gen_random_uuid(),
  court_id uuid references public.courts(id) on delete cascade,
  company_name text not null,
  day_of_week integer not null,
  start_time time not null,
  end_time time not null,
  court_type text not null,
  price_lkr numeric(12,2),
  date_from date not null,
  date_to date not null,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- The existing project reportedly has this helper (used by admin RLS policies).
create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin')
$$;

-- Approximation of today's permissive state: RLS enabled with broad policies,
-- so tests prove the new policy migration actually closes the gaps.
alter table public.slots enable row level security;
create policy legacy_slots_all on public.slots for all to anon, authenticated using (true) with check (true);
alter table public.bookings enable row level security;
create policy legacy_bookings_all on public.bookings for all to authenticated using (true) with check (true);
alter table public.profiles enable row level security;
create policy legacy_profiles_all on public.profiles for all to authenticated using (true) with check (true);
alter table public.otp_verifications enable row level security;
create policy legacy_otp_all on public.otp_verifications for all to authenticated using (true) with check (true);
