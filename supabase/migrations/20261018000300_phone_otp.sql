-- ArenaGrade production-readiness: server-side phone OTP.
--
-- Before: the browser generated the code, inserted it into otp_verifications
-- (readable by the same browser), compared it itself, and then set
-- profiles.phone_verified = true directly. Every step was bypassable.
--
-- After:
--   * the server generates the code with a CSPRNG and stores only an HMAC of it
--     (keyed by a server secret, bound to user + phone)
--   * issuing and verifying run in these service_role-only functions, with
--     limits enforced under advisory locks so parallel requests and multiple
--     server instances cannot exceed them
--   * a trigger stops browser sessions from changing role / phone /
--     phone_verified on profiles at all

alter table public.profiles add column if not exists phone_verified_at timestamptz;

create table if not exists public.phone_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  phone text not null,
  code_hash text not null,
  ip_hash text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  consumed_at timestamptz,
  superseded_at timestamptz,
  sms_status text not null default 'pending' check (sms_status in ('pending', 'accepted', 'failed')),
  provider_message_id text
);
create index if not exists phone_otp_user_idx on public.phone_otp_challenges (user_id, created_at desc);
create index if not exists phone_otp_phone_idx on public.phone_otp_challenges (phone, created_at desc);
create index if not exists phone_otp_ip_idx on public.phone_otp_challenges (ip_hash, created_at desc) where ip_hash is not null;
alter table public.phone_otp_challenges enable row level security;
-- No policies: only service_role (server) can touch this table.
revoke all on public.phone_otp_challenges from anon, authenticated;

-- Legacy table held plaintext codes readable by the browser. Close it.
alter table public.otp_verifications enable row level security;
revoke all on public.otp_verifications from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Issue a challenge. Returns {allowed, reason, retry_after_seconds, challenge_id}.
-- Reasons: cooldown, phone_limit, user_limit, ip_limit, daily_cap.
-- ---------------------------------------------------------------------------
create or replace function public.otp_issue_challenge(
  p_user_id uuid,
  p_phone text,
  p_code_hash text,
  p_ip_hash text,
  p_ttl_seconds integer default 600,
  p_cooldown_seconds integer default 60,
  p_phone_limit integer default 3,
  p_phone_window_seconds integer default 600,
  p_user_limit integer default 6,
  p_ip_limit integer default 10,
  p_daily_cap integer default 300
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last timestamptz;
  v_count integer;
  v_oldest timestamptz;
  v_id uuid;
  v_day_start timestamptz := ((public.colombo_now())::date)::timestamp at time zone 'Asia/Colombo';
begin
  if p_user_id is null or p_phone is null or p_code_hash is null then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;

  -- Fixed lock order (global, phone, user) — no deadlocks between callers.
  perform pg_advisory_xact_lock(hashtextextended('otp_global', 0));
  perform pg_advisory_xact_lock(hashtextextended('otp_phone:' || p_phone, 0));
  perform pg_advisory_xact_lock(hashtextextended('otp_user:' || p_user_id::text, 0));

  select max(created_at) into v_last
  from public.phone_otp_challenges where user_id = p_user_id and phone = p_phone;
  if v_last is not null and v_last > now() - make_interval(secs => p_cooldown_seconds) then
    return jsonb_build_object('allowed', false, 'reason', 'cooldown',
      'retry_after_seconds', ceil(extract(epoch from v_last + make_interval(secs => p_cooldown_seconds) - now()))::int);
  end if;

  select count(*), min(created_at) into v_count, v_oldest
  from public.phone_otp_challenges
  where phone = p_phone and created_at > now() - make_interval(secs => p_phone_window_seconds);
  if v_count >= p_phone_limit then
    return jsonb_build_object('allowed', false, 'reason', 'phone_limit',
      'retry_after_seconds', ceil(extract(epoch from v_oldest + make_interval(secs => p_phone_window_seconds) - now()))::int);
  end if;

  select count(*), min(created_at) into v_count, v_oldest
  from public.phone_otp_challenges where user_id = p_user_id and created_at > now() - interval '1 hour';
  if v_count >= p_user_limit then
    return jsonb_build_object('allowed', false, 'reason', 'user_limit',
      'retry_after_seconds', ceil(extract(epoch from v_oldest + interval '1 hour' - now()))::int);
  end if;

  if p_ip_hash is not null then
    select count(*), min(created_at) into v_count, v_oldest
    from public.phone_otp_challenges where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
    if v_count >= p_ip_limit then
      return jsonb_build_object('allowed', false, 'reason', 'ip_limit',
        'retry_after_seconds', ceil(extract(epoch from v_oldest + interval '1 hour' - now()))::int);
    end if;
  end if;

  select count(*) into v_count from public.phone_otp_challenges where created_at >= v_day_start;
  if v_count >= p_daily_cap then
    perform public.record_app_event('critical', 'sms', 'otp_daily_cap_reached', null,
      jsonb_build_object('cap', p_daily_cap), true);
    return jsonb_build_object('allowed', false, 'reason', 'daily_cap', 'retry_after_seconds', 3600);
  end if;

  -- Only the newest code for this user is ever valid.
  update public.phone_otp_challenges
  set superseded_at = now()
  where user_id = p_user_id and consumed_at is null and superseded_at is null;

  insert into public.phone_otp_challenges (user_id, phone, code_hash, ip_hash, expires_at)
  values (p_user_id, p_phone, p_code_hash, p_ip_hash, now() + make_interval(secs => p_ttl_seconds))
  returning id into v_id;

  return jsonb_build_object('allowed', true, 'challenge_id', v_id, 'retry_after_seconds', 0);
end $$;
revoke all on function public.otp_issue_challenge(uuid, text, text, text, integer, integer, integer, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.otp_issue_challenge(uuid, text, text, text, integer, integer, integer, integer, integer, integer, integer) to service_role;

-- Record what the SMS provider said. 'accepted' means the provider took the
-- request — not that the handset received it.
create or replace function public.otp_mark_sms(p_challenge_id uuid, p_status text, p_provider_message_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.phone_otp_challenges
  set sms_status = p_status, provider_message_id = p_provider_message_id
  where id = p_challenge_id
$$;
revoke all on function public.otp_mark_sms(uuid, text, text) from public, anon, authenticated;
grant execute on function public.otp_mark_sms(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Verify. Returns {ok, reason, attempts_left}.
-- Reasons: no_active_code, expired, too_many_attempts, invalid_code.
-- On success the challenge is consumed (one-time) and the profile is marked
-- verified for exactly this phone number.
-- ---------------------------------------------------------------------------
create or replace function public.otp_verify_challenge(p_user_id uuid, p_phone text, p_code_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.phone_otp_challenges%rowtype;
  v_left integer;
  v_profiles integer;
begin
  select * into c
  from public.phone_otp_challenges
  where user_id = p_user_id and phone = p_phone
    and consumed_at is null and superseded_at is null and sms_status <> 'failed'
  order by created_at desc
  limit 1
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_active_code', 'attempts_left', 0);
  end if;
  if c.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired', 'attempts_left', 0);
  end if;
  if c.attempts >= c.max_attempts then
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts', 'attempts_left', 0);
  end if;

  if c.code_hash <> p_code_hash then
    update public.phone_otp_challenges set attempts = attempts + 1 where id = c.id;
    v_left := c.max_attempts - (c.attempts + 1);
    return jsonb_build_object('ok', false,
      'reason', case when v_left <= 0 then 'too_many_attempts' else 'invalid_code' end,
      'attempts_left', greatest(v_left, 0));
  end if;

  update public.phone_otp_challenges set consumed_at = now() where id = c.id;

  update public.profiles
  set phone = p_phone, phone_verified = true, phone_verified_at = now()
  where id = p_user_id;
  get diagnostics v_profiles = row_count;
  if v_profiles = 0 then
    raise exception 'profile_missing' using errcode = 'P0002';
  end if;

  perform public.write_audit(p_user_id, 'user', 'phone.verified', 'profile', p_user_id::text,
                             jsonb_build_object('phone_last3', right(p_phone, 3)));
  return jsonb_build_object('ok', true, 'reason', null, 'attempts_left', null);
end $$;
revoke all on function public.otp_verify_challenge(uuid, text, text) from public, anon, authenticated;
grant execute on function public.otp_verify_challenge(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Browser sessions may not change role, phone or phone_verified.
-- (Server functions run as the function owner and are unaffected.)
-- ---------------------------------------------------------------------------
create or replace function public.profiles_guard_privileged_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      if new.role::text = 'super_admin' or coalesce(new.phone_verified, false) then
        raise exception 'forbidden_profile_fields' using errcode = '42501';
      end if;
    elsif new.role is distinct from old.role
       or new.phone is distinct from old.phone
       or new.phone_verified is distinct from old.phone_verified
       or new.phone_verified_at is distinct from old.phone_verified_at then
      raise exception 'forbidden_profile_fields' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.profiles_guard_privileged_columns() from public, anon, authenticated;

drop trigger if exists profiles_guard_privileged_columns on public.profiles;
create trigger profiles_guard_privileged_columns
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_privileged_columns();
