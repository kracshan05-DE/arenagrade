-- ArenaGrade production-readiness: server-authoritative payments.
--
-- Rules (confirmed by the owner, 2026-10-17):
--   * a booking is confirmed ONLY when a verified provider notification says
--     the payment succeeded, while the customer's 10-minute hold is still valid
--   * if the hold ended first, the court has already been released; a later
--     success is kept as 'succeeded_unconfirmed' with a pending refund, and an
--     incident is raised — a conflicting booking is never created
--
-- Payment attempts (one per hold) are kept separate from bookings; every
-- provider notification is stored in payment_events, deduplicated by event_key.

create table if not exists public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique,
  user_id uuid not null references auth.users(id),
  slot_id uuid not null references public.slots(id),
  court_id uuid not null references public.courts(id),
  amount_lkr numeric(12, 2) not null check (amount_lkr > 0),
  currency text not null default 'LKR' check (currency = 'LKR'),
  provider text not null check (provider in ('payhere', 'simulator')),
  environment text not null check (environment in ('sandbox', 'live', 'test')),
  hold_expires_at timestamptz not null,
  status text not null default 'initiated'
    check (status in ('initiated', 'pending', 'succeeded', 'succeeded_unconfirmed', 'failed', 'cancelled', 'charged_back')),
  provider_payment_id text,
  provider_status_code integer,
  booking_id uuid references public.bookings(id),
  reconciliation_status text check (reconciliation_status in ('refund_required', 'refund_recorded', 'resolved')),
  reconciliation_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create index if not exists payment_attempts_user_idx on public.payment_attempts (user_id, created_at desc);
create index if not exists payment_attempts_slot_idx on public.payment_attempts (slot_id);
create index if not exists payment_attempts_status_idx on public.payment_attempts (status, updated_at);
-- At most one open attempt per hold: repeated "Pay" clicks reuse it.
create unique index if not exists payment_attempts_one_open_per_hold
  on public.payment_attempts (slot_id, user_id, hold_expires_at)
  where status in ('initiated', 'pending');

create table if not exists public.payment_events (
  id bigint generated always as identity primary key,
  provider text not null,
  order_id text,
  provider_payment_id text,
  status_code integer,
  amount text,
  currency text,
  signature_valid boolean not null,
  event_key text not null unique,
  result text,
  duplicate_count integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists payment_events_order_idx on public.payment_events (order_id);
create index if not exists payment_events_received_idx on public.payment_events (received_at);

-- Manual refunds (bank transfer via WhatsApp). Status is recorded by an admin;
-- "completed" requires a bank reference. Linked to the booking and/or the
-- verified payment attempt; one refund per booking and per attempt.
create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id),
  payment_attempt_id uuid references public.payment_attempts(id),
  amount_lkr numeric(12, 2) not null check (amount_lkr >= 0),
  status text not null default 'pending' check (status in ('pending', 'initiated', 'completed', 'cancelled')),
  bank_reference text,
  note text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  initiated_at timestamptz,
  completed_at timestamptz,
  check (booking_id is not null or payment_attempt_id is not null),
  check (status <> 'completed' or nullif(btrim(bank_reference), '') is not null)
);
create unique index if not exists refunds_one_per_booking on public.refunds (booking_id) where booking_id is not null;
create unique index if not exists refunds_one_per_attempt on public.refunds (payment_attempt_id) where payment_attempt_id is not null;
create index if not exists refunds_status_idx on public.refunds (status);

alter table public.payment_attempts enable row level security;
alter table public.payment_events enable row level security;
alter table public.refunds enable row level security;

-- ---------------------------------------------------------------------------
-- Create (or reuse) the payment attempt for the caller's current hold.
-- Called by the server after it has authenticated the user. The amount comes
-- from the slot row, never from the browser. Requires a verified phone.
-- Errors: hold_invalid_or_expiring, phone_not_verified, slot_price_invalid
-- ---------------------------------------------------------------------------
create or replace function public.payment_create_attempt(
  p_user_id uuid, p_slot_id uuid, p_provider text, p_environment text, p_min_seconds_left integer default 60
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot public.slots%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_verified boolean;
  v_order text;
begin
  select * into v_slot from public.slots s where s.id = p_slot_id for update;
  if not found
     or v_slot.status::text <> 'locked'
     or v_slot.locked_by is distinct from p_user_id
     or v_slot.lock_expires_at <= now() + make_interval(secs => p_min_seconds_left) then
    raise exception 'hold_invalid_or_expiring' using errcode = 'P0001';
  end if;

  select coalesce(p.phone_verified, false) into v_verified from public.profiles p where p.id = p_user_id;
  if not coalesce(v_verified, false) then
    raise exception 'phone_not_verified' using errcode = 'P0001';
  end if;

  if v_slot.price_lkr is null or v_slot.price_lkr <= 0 then
    raise exception 'slot_price_invalid' using errcode = 'P0001';
  end if;

  select * into v_attempt from public.payment_attempts a
  where a.slot_id = p_slot_id and a.user_id = p_user_id and a.hold_expires_at = v_slot.lock_expires_at
    and a.status in ('initiated', 'pending')
  limit 1;

  if not found then
    v_order := 'AG' || to_char(public.colombo_now(), 'YYMMDDHH24MISS') || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    insert into public.payment_attempts (order_id, user_id, slot_id, court_id, amount_lkr, provider, environment, hold_expires_at)
    values (v_order, p_user_id, v_slot.id, v_slot.court_id, v_slot.price_lkr, p_provider, p_environment, v_slot.lock_expires_at)
    returning * into v_attempt;
    perform public.write_audit(p_user_id, 'user', 'payment.initiated', 'payment_attempt', v_attempt.order_id,
      jsonb_build_object('amount_lkr', v_attempt.amount_lkr, 'provider', p_provider, 'environment', p_environment));
  end if;

  return jsonb_build_object(
    'order_id', v_attempt.order_id,
    'amount', to_char(v_attempt.amount_lkr, 'FM9999999990.00'),
    'currency', v_attempt.currency,
    'provider', v_attempt.provider,
    'environment', v_attempt.environment,
    'hold_expires_at', v_attempt.hold_expires_at,
    'slot_id', v_attempt.slot_id,
    'court_id', v_attempt.court_id
  );
end $$;
revoke all on function public.payment_create_attempt(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.payment_create_attempt(uuid, uuid, text, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Apply one provider notification. Idempotent and safe under concurrency:
--   * duplicates (same event_key) are counted, never re-applied
--   * the attempt row is locked, so parallel notifications serialize
--   * out-of-order events never downgrade a success
-- p_signature_valid is computed by the server from the provider's signature.
-- Results: duplicate, invalid_signature, unknown_order, provider_mismatch,
--   malformed, amount_mismatch, unknown_status, pending, failed, cancelled,
--   stale_ignored, already_confirmed, confirmed, paid_unconfirmed, charged_back
-- ---------------------------------------------------------------------------
create or replace function public.payment_apply_notification(
  p_provider text,
  p_order_id text,
  p_provider_payment_id text,
  p_status_code integer,
  p_amount text,
  p_currency text,
  p_signature_valid boolean,
  p_event_key text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted boolean;
  v_attempt public.payment_attempts%rowtype;
  v_slot public.slots%rowtype;
  v_amount numeric;
  v_new_status text;
  v_result text;
  v_booking_id uuid;
  v_refund_id uuid;
begin
  insert into public.payment_events as e
    (provider, order_id, provider_payment_id, status_code, amount, currency, signature_valid, event_key, payload)
  values (p_provider, p_order_id, p_provider_payment_id, p_status_code, p_amount, p_currency,
          coalesce(p_signature_valid, false), p_event_key, coalesce(p_payload, '{}'::jsonb))
  on conflict (event_key) do update
    set duplicate_count = e.duplicate_count + 1, last_seen_at = now()
  returning (xmax = 0) into v_inserted;

  if not v_inserted then
    return jsonb_build_object('result', 'duplicate', 'order_id', p_order_id);
  end if;

  if not coalesce(p_signature_valid, false) then
    v_result := 'invalid_signature';
    perform public.record_app_event('warning', 'payment', 'notification_invalid_signature', p_order_id,
      jsonb_build_object('provider', p_provider), false);
    update public.payment_events set result = v_result where event_key = p_event_key;
    return jsonb_build_object('result', v_result, 'order_id', p_order_id);
  end if;

  select * into v_attempt from public.payment_attempts a where a.order_id = p_order_id for update;
  if not found then
    v_result := 'unknown_order';
    perform public.record_app_event('critical', 'payment', 'notification_unknown_order', p_order_id,
      jsonb_build_object('provider', p_provider, 'status_code', p_status_code, 'amount', p_amount), true);
    update public.payment_events set result = v_result where event_key = p_event_key;
    return jsonb_build_object('result', v_result, 'order_id', p_order_id);
  end if;

  if v_attempt.provider <> p_provider then
    v_result := 'provider_mismatch';
    perform public.record_app_event('critical', 'payment', 'notification_provider_mismatch', p_order_id,
      jsonb_build_object('expected', v_attempt.provider, 'got', p_provider), true);
    update public.payment_events set result = v_result where event_key = p_event_key;
    return jsonb_build_object('result', v_result, 'order_id', p_order_id);
  end if;

  begin
    v_amount := p_amount::numeric;
  exception when others then
    v_amount := null;
  end;
  if v_amount is null or p_currency is null then
    v_result := 'malformed';
  elsif v_amount <> v_attempt.amount_lkr or upper(p_currency) <> v_attempt.currency then
    v_result := 'amount_mismatch';
  end if;
  if v_result is not null then
    perform public.record_app_event('critical', 'payment', 'notification_' || v_result, p_order_id,
      jsonb_build_object('expected_amount', v_attempt.amount_lkr, 'amount', p_amount, 'currency', p_currency,
                         'status_code', p_status_code), true);
    if p_status_code = 2 then
      update public.payment_attempts
      set reconciliation_status = 'refund_required',
          reconciliation_note = 'Provider reported success with ' || v_result,
          provider_payment_id = coalesce(p_provider_payment_id, provider_payment_id),
          updated_at = now()
      where id = v_attempt.id;
    end if;
    update public.payment_events set result = v_result where event_key = p_event_key;
    return jsonb_build_object('result', v_result, 'order_id', p_order_id);
  end if;

  v_new_status := case p_status_code
    when 2 then 'succeeded' when 0 then 'pending' when -1 then 'cancelled'
    when -2 then 'failed' when -3 then 'charged_back' else null end;
  if v_new_status is null then
    v_result := 'unknown_status';
    perform public.record_app_event('error', 'payment', 'notification_unknown_status', p_order_id,
      jsonb_build_object('status_code', p_status_code), true);
    update public.payment_events set result = v_result where event_key = p_event_key;
    return jsonb_build_object('result', v_result, 'order_id', p_order_id);
  end if;

  -- Already settled as paid: only a chargeback can change it.
  if v_attempt.status in ('succeeded', 'succeeded_unconfirmed', 'charged_back') then
    if v_new_status = 'charged_back' and v_attempt.status <> 'charged_back' then
      update public.payment_attempts
      set status = 'charged_back', provider_status_code = p_status_code, updated_at = now(),
          reconciliation_note = 'Chargeback reported by provider'
      where id = v_attempt.id;
      perform public.record_app_event('critical', 'payment', 'chargeback', p_order_id,
        jsonb_build_object('booking_id', v_attempt.booking_id, 'amount_lkr', v_attempt.amount_lkr), true);
      v_result := 'charged_back';
    elsif v_new_status = 'succeeded' then
      v_result := 'already_confirmed';
    else
      v_result := 'stale_ignored';
    end if;
    update public.payment_events set result = v_result where event_key = p_event_key;
    return jsonb_build_object('result', v_result, 'order_id', p_order_id, 'booking_id', v_attempt.booking_id,
                              'user_id', v_attempt.user_id, 'slot_id', v_attempt.slot_id);
  end if;

  if v_new_status in ('pending', 'failed', 'cancelled', 'charged_back') then
    update public.payment_attempts
    set status = case when v_new_status = 'charged_back' then status else v_new_status end,
        provider_payment_id = coalesce(p_provider_payment_id, provider_payment_id),
        provider_status_code = p_status_code, updated_at = now()
    where id = v_attempt.id;
    v_result := v_new_status;
    update public.payment_events set result = v_result where event_key = p_event_key;
    return jsonb_build_object('result', v_result, 'order_id', p_order_id, 'user_id', v_attempt.user_id,
                              'slot_id', v_attempt.slot_id);
  end if;

  -- Verified success. Confirm only against the exact hold this attempt was for.
  select * into v_slot from public.slots s where s.id = v_attempt.slot_id for update;

  if found
     and v_slot.status::text = 'locked'
     and v_slot.locked_by = v_attempt.user_id
     and v_slot.lock_expires_at = v_attempt.hold_expires_at
     and v_slot.lock_expires_at > now() then

    update public.slots s
    set status = 'booked', locked_by = null, lock_expires_at = null, version = s.version + 1
    where s.id = v_slot.id;

    insert into public.bookings (user_id, slot_id, court_id, status, total_lkr, payhere_payment_id, idempotency_key)
    values (v_attempt.user_id, v_slot.id, v_slot.court_id, 'confirmed', v_attempt.amount_lkr,
            coalesce(p_provider_payment_id, v_attempt.order_id), v_attempt.order_id)
    returning id into v_booking_id;

    update public.payment_attempts
    set status = 'succeeded', booking_id = v_booking_id, confirmed_at = now(),
        provider_payment_id = coalesce(p_provider_payment_id, provider_payment_id),
        provider_status_code = p_status_code, updated_at = now()
    where id = v_attempt.id;

    -- Keep the legacy audit table populated for the existing dashboard.
    insert into public.payment_audit (payhere_payment_id, entity_type, entity_id, event_type, amount_lkr, raw_payload)
    values (coalesce(p_provider_payment_id, v_attempt.order_id), 'booking', v_slot.id, 'completed', v_attempt.amount_lkr,
            jsonb_build_object('order_id', v_attempt.order_id, 'provider', p_provider,
                               'environment', v_attempt.environment, 'simulated', p_provider = 'simulator'))
    on conflict do nothing;

    perform public.write_audit(v_attempt.user_id, 'provider', 'booking.confirmed', 'booking', v_booking_id::text,
      jsonb_build_object('order_id', v_attempt.order_id, 'amount_lkr', v_attempt.amount_lkr));
    v_result := 'confirmed';
  else
    update public.payment_attempts
    set status = 'succeeded_unconfirmed', reconciliation_status = 'refund_required',
        reconciliation_note = 'Payment succeeded after the hold ended; slot was not confirmed',
        provider_payment_id = coalesce(p_provider_payment_id, provider_payment_id),
        provider_status_code = p_status_code, updated_at = now()
    where id = v_attempt.id;

    insert into public.refunds (payment_attempt_id, amount_lkr, status, note)
    values (v_attempt.id, v_attempt.amount_lkr, 'pending', 'Auto: paid after hold expired')
    on conflict do nothing
    returning id into v_refund_id;

    perform public.record_app_event('critical', 'payment', 'paid_without_booking', v_attempt.order_id,
      jsonb_build_object('slot_id', v_attempt.slot_id, 'amount_lkr', v_attempt.amount_lkr,
                         'slot_status', v_slot.status, 'refund_id', v_refund_id), true);
    v_result := 'paid_unconfirmed';
  end if;

  update public.payment_events set result = v_result where event_key = p_event_key;
  return jsonb_build_object('result', v_result, 'order_id', v_attempt.order_id, 'booking_id', v_booking_id,
                            'user_id', v_attempt.user_id, 'slot_id', v_attempt.slot_id,
                            'amount', to_char(v_attempt.amount_lkr, 'FM9999999990.00'));
end $$;
revoke all on function public.payment_apply_notification(text, text, text, integer, text, text, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.payment_apply_notification(text, text, text, integer, text, text, boolean, text, jsonb) to service_role;
