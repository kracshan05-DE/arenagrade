-- ArenaGrade production-readiness: cancellation and manual-refund workflow.
--
-- Booking statuses (existing values kept): confirmed -> cancellation_requested
--   -> cancelled (approved) | confirmed (rejected).
-- Refund statuses (new, separate table): pending -> initiated -> completed,
--   or cancelled. Approval creates a PENDING refund; money is only recorded as
--   refunded when an admin marks it completed with a bank reference.
-- Rules: customer may request only for their own confirmed booking, at least
--   24 hours before the slot start in Asia/Colombo time. Availability is
--   released when the admin approves.

alter table public.bookings add column if not exists cancellation_requested_at timestamptz;
alter table public.bookings add column if not exists cancelled_at timestamptz;
alter table public.bookings add column if not exists decided_by uuid;
alter table public.bookings add column if not exists decision_note text;

-- Internal: the details an SMS about this booking needs.
create or replace function public._booking_notice(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'booking_id', b.id,
    'user_id', b.user_id,
    'status', b.status,
    'amount', to_char(b.total_lkr, 'FM9999999990.00'),
    'customer_phone', p.phone,
    'customer_name', p.full_name,
    'court_name', c.name,
    'court_type', s.court_type,
    'slot_date', s.slot_date,
    'start_time', to_char(s.start_time, 'HH24:MI'),
    'end_time', to_char(s.end_time, 'HH24:MI'),
    'reason', b.cancellation_reason
  )
  from public.bookings b
  left join public.slots s on s.id = b.slot_id
  left join public.courts c on c.id = b.court_id
  left join public.profiles p on p.id = b.user_id
  where b.id = p_booking_id
$$;
revoke all on function public._booking_notice(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Customer: request cancellation. Idempotent: a repeat returns changed=false.
-- Errors: not_authenticated, booking_not_found, booking_not_cancellable,
--         cancellation_window_closed, invalid_reason
-- ---------------------------------------------------------------------------
create or replace function public.request_booking_cancellation(p_booking_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  b public.bookings%rowtype;
  s public.slots%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into b from public.bookings x where x.id = p_booking_id for update;
  if not found or b.user_id <> v_uid then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;

  if b.status::text = 'cancellation_requested' then
    return jsonb_build_object('changed', false) || public._booking_notice(b.id);
  end if;
  if b.status::text <> 'confirmed' then
    raise exception 'booking_not_cancellable' using errcode = 'P0001';
  end if;

  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'invalid_reason' using errcode = 'P0001';
  end if;

  select * into s from public.slots x where x.id = b.slot_id;
  if not found or (s.slot_date + s.start_time) - public.colombo_now() < interval '24 hours' then
    raise exception 'cancellation_window_closed' using errcode = 'P0001';
  end if;

  update public.bookings
  set status = 'cancellation_requested', cancellation_reason = v_reason, cancellation_requested_at = now(),
      decided_by = null, decision_note = null
  where id = b.id;

  perform public.write_audit(v_uid, 'user', 'booking.cancellation_requested', 'booking', b.id::text,
                             jsonb_build_object('reason', v_reason));
  return jsonb_build_object('changed', true) || public._booking_notice(b.id);
end $$;
revoke all on function public.request_booking_cancellation(uuid, text) from public, anon;
grant execute on function public.request_booking_cancellation(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: approve or reject a cancellation request. Idempotent per decision.
-- Errors: forbidden, booking_not_found, invalid_decision,
--         booking_not_pending_cancellation
-- ---------------------------------------------------------------------------
create or replace function public.admin_decide_cancellation(p_booking_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  b public.bookings%rowtype;
  v_attempt_id uuid;
  v_refund_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;

  select * into b from public.bookings x where x.id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;

  if p_decision = 'approve' then
    if b.status::text = 'cancelled' then
      return jsonb_build_object('changed', false, 'decision', p_decision,
        'refund_id', (select r.id from public.refunds r where r.booking_id = b.id)) || public._booking_notice(b.id);
    end if;
    if b.status::text <> 'cancellation_requested' then
      raise exception 'booking_not_pending_cancellation' using errcode = 'P0001';
    end if;

    perform 1 from public.slots s where s.id = b.slot_id for update;

    update public.bookings
    set status = 'cancelled', cancelled_by = 'admin', cancelled_at = now(), refund_amount_lkr = b.total_lkr,
        decided_by = v_uid, decision_note = nullif(btrim(coalesce(p_note, '')), '')
    where id = b.id;

    update public.slots s
    set status = 'available', locked_by = null, lock_expires_at = null, version = s.version + 1
    where s.id = b.slot_id and s.status::text = 'booked';

    select a.id into v_attempt_id from public.payment_attempts a where a.booking_id = b.id limit 1;
    insert into public.refunds (booking_id, payment_attempt_id, amount_lkr, status, created_by, updated_by)
    values (b.id, v_attempt_id, b.total_lkr, 'pending', v_uid, v_uid)
    on conflict do nothing
    returning id into v_refund_id;
    if v_refund_id is null then
      select r.id into v_refund_id from public.refunds r where r.booking_id = b.id;
    end if;

    perform public.write_audit(v_uid, 'admin', 'booking.cancellation_approved', 'booking', b.id::text,
      jsonb_build_object('refund_id', v_refund_id, 'amount_lkr', b.total_lkr));
    return jsonb_build_object('changed', true, 'decision', p_decision, 'refund_id', v_refund_id) || public._booking_notice(b.id);
  end if;

  -- reject
  if b.status::text = 'confirmed' and b.decided_by is not null then
    return jsonb_build_object('changed', false, 'decision', p_decision) || public._booking_notice(b.id);
  end if;
  if b.status::text <> 'cancellation_requested' then
    raise exception 'booking_not_pending_cancellation' using errcode = 'P0001';
  end if;
  update public.bookings
  set status = 'confirmed', decided_by = v_uid, decision_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = b.id;
  perform public.write_audit(v_uid, 'admin', 'booking.cancellation_rejected', 'booking', b.id::text, '{}'::jsonb);
  return jsonb_build_object('changed', true, 'decision', p_decision) || public._booking_notice(b.id);
end $$;
revoke all on function public.admin_decide_cancellation(uuid, text, text) from public, anon;
grant execute on function public.admin_decide_cancellation(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: move a refund forward. completed requires a bank reference and is
-- final. Errors: forbidden, refund_not_found, invalid_refund_transition,
--                bank_reference_required
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_refund(p_refund_id uuid, p_status text, p_bank_reference text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r public.refunds%rowtype;
  v_ref text := nullif(btrim(coalesce(p_bank_reference, '')), '');
begin
  if not public.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into r from public.refunds x where x.id = p_refund_id for update;
  if not found then
    raise exception 'refund_not_found' using errcode = 'P0002';
  end if;

  if r.status = p_status then
    return jsonb_build_object('changed', false, 'status', r.status);
  end if;
  if not ((r.status = 'pending' and p_status in ('initiated', 'completed', 'cancelled'))
       or (r.status = 'initiated' and p_status in ('completed', 'cancelled'))) then
    raise exception 'invalid_refund_transition' using errcode = 'P0001';
  end if;
  if p_status = 'completed' and v_ref is null then
    raise exception 'bank_reference_required' using errcode = 'P0001';
  end if;

  update public.refunds
  set status = p_status,
      bank_reference = coalesce(v_ref, bank_reference),
      note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note),
      updated_by = v_uid, updated_at = now(),
      initiated_at = case when p_status = 'initiated' then now() else initiated_at end,
      completed_at = case when p_status = 'completed' then now() else completed_at end
  where id = r.id;

  if p_status = 'completed' and r.payment_attempt_id is not null then
    update public.payment_attempts
    set reconciliation_status = 'refund_recorded', updated_at = now()
    where id = r.payment_attempt_id and reconciliation_status = 'refund_required';
  end if;

  perform public.write_audit(v_uid, 'admin', 'refund.' || p_status, 'refund', r.id::text,
    jsonb_build_object('from', r.status, 'amount_lkr', r.amount_lkr, 'has_reference', v_ref is not null));
  return jsonb_build_object('changed', true, 'status', p_status);
end $$;
revoke all on function public.admin_update_refund(uuid, text, text, text) from public, anon;
grant execute on function public.admin_update_refund(uuid, text, text, text) to authenticated;
