-- ArenaGrade production-readiness: notification log, job runs, daily report.

-- Every SMS/email the server sends. idempotency_key makes a logical message
-- send at most once (a retry after failure is allowed). Recipients are stored
-- masked; message bodies are not stored (they can contain OTPs).
create table if not exists public.notification_log (
  id bigint generated always as identity primary key,
  channel text not null check (channel in ('sms', 'email')),
  template text not null,
  recipient_masked text,
  related_type text,
  related_id text,
  idempotency_key text not null unique,
  status text not null check (status in ('sending', 'accepted', 'failed', 'skipped')),
  provider_message_id text,
  error text,
  attempts integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notification_log_created_idx on public.notification_log (created_at);
alter table public.notification_log enable row level security;

-- Claim the right to send. Returns {claimed, status}. A message already
-- accepted, or being sent within the last 2 minutes, is not claimed again.
create or replace function public.notification_claim(
  p_channel text, p_template text, p_recipient_masked text, p_related_type text, p_related_id text, p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n public.notification_log%rowtype;
begin
  insert into public.notification_log (channel, template, recipient_masked, related_type, related_id, idempotency_key, status)
  values (p_channel, p_template, p_recipient_masked, p_related_type, p_related_id, p_idempotency_key, 'sending')
  on conflict (idempotency_key) do nothing
  returning * into n;
  if found then
    return jsonb_build_object('claimed', true, 'status', 'sending');
  end if;

  select * into n from public.notification_log where idempotency_key = p_idempotency_key for update;
  if n.status = 'failed' or (n.status = 'sending' and n.updated_at < now() - interval '2 minutes') then
    update public.notification_log
    set status = 'sending', attempts = attempts + 1, updated_at = now(), error = null
    where id = n.id;
    return jsonb_build_object('claimed', true, 'status', 'sending');
  end if;
  return jsonb_build_object('claimed', false, 'status', n.status);
end $$;
revoke all on function public.notification_claim(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.notification_claim(text, text, text, text, text, text) to service_role;

create or replace function public.notification_finish(p_idempotency_key text, p_status text, p_provider_message_id text, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notification_log
  set status = p_status, provider_message_id = p_provider_message_id, error = left(p_error, 500), updated_at = now()
  where idempotency_key = p_idempotency_key
$$;
revoke all on function public.notification_finish(text, text, text, text) from public, anon, authenticated;
grant execute on function public.notification_finish(text, text, text, text) to service_role;

-- Scheduled-job bookkeeping. One row per logical run (job + period).
create table if not exists public.job_runs (
  id bigint generated always as identity primary key,
  job_name text not null,
  period_key text not null,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  attempts integer not null default 1,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  last_error text,
  details jsonb not null default '{}'::jsonb,
  unique (job_name, period_key)
);
alter table public.job_runs enable row level security;

-- Returns {claimed, status, attempts}. Not claimed when already succeeded
-- (unless p_force) or when another run started in the last p_stale_seconds.
create or replace function public.job_claim(p_job_name text, p_period_key text, p_force boolean default false, p_stale_seconds integer default 900)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.job_runs%rowtype;
begin
  insert into public.job_runs (job_name, period_key, status)
  values (p_job_name, p_period_key, 'running')
  on conflict (job_name, period_key) do nothing
  returning * into j;
  if found then
    return jsonb_build_object('claimed', true, 'status', 'running', 'attempts', 1);
  end if;

  select * into j from public.job_runs where job_name = p_job_name and period_key = p_period_key for update;
  if j.status = 'running' and j.started_at > now() - make_interval(secs => p_stale_seconds) then
    return jsonb_build_object('claimed', false, 'status', 'running', 'attempts', j.attempts);
  end if;
  if j.status = 'succeeded' and not p_force then
    return jsonb_build_object('claimed', false, 'status', 'succeeded', 'attempts', j.attempts);
  end if;
  update public.job_runs
  set status = 'running', attempts = attempts + 1, started_at = now(), finished_at = null, last_error = null
  where id = j.id;
  return jsonb_build_object('claimed', true, 'status', 'running', 'attempts', j.attempts + 1);
end $$;
revoke all on function public.job_claim(text, text, boolean, integer) from public, anon, authenticated;
grant execute on function public.job_claim(text, text, boolean, integer) to service_role;

create or replace function public.job_finish(p_job_name text, p_period_key text, p_status text, p_error text, p_details jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.job_runs
  set status = p_status, finished_at = now(), last_error = left(p_error, 1000), details = coalesce(p_details, details)
  where job_name = p_job_name and period_key = p_period_key
$$;
revoke all on function public.job_finish(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.job_finish(text, text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Daily operations report data for [p_from, p_to). Money comes only from
-- payment_attempts (one row per order, so provider retries cannot double
-- count) and is split by environment; only 'live' is real revenue.
-- Contains no names, phone numbers or emails.
-- ---------------------------------------------------------------------------
create or replace function public.report_daily(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  with
  pa as (select * from public.payment_attempts),
  bk as (select * from public.bookings),
  au as (select * from public.audit_log where created_at >= p_from and created_at < p_to),
  ev as (select * from public.app_events where created_at >= p_from and created_at < p_to)
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'bookings', jsonb_build_object(
      'created', (select count(*) from bk where created_at >= p_from and created_at < p_to),
      'created_by_status', coalesce((select jsonb_object_agg(status, n) from (
          select status::text as status, count(*) n from bk where created_at >= p_from and created_at < p_to group by 1) x), '{}'::jsonb),
      'cancellation_requests', (select count(*) from au where action = 'booking.cancellation_requested'),
      'cancellations_approved', (select count(*) from au where action = 'booking.cancellation_approved'),
      'cancellations_rejected', (select count(*) from au where action = 'booking.cancellation_rejected'),
      'holds_created', (select count(*) from au where action = 'slot.hold'),
      'holds_released_by_customer', (select count(*) from au where action = 'slot.release'),
      'holds_confirmed', (select count(*) from au where action = 'booking.confirmed'),
      'active_holds_now', (select count(*) from public.slots s where s.status::text = 'locked' and s.lock_expires_at > now()),
      'pending_cancellation_requests_now', (select count(*) from bk where status::text = 'cancellation_requested')
    ),
    'payments', jsonb_build_object(
      'live_succeeded_count', (select count(*) from pa where environment = 'live' and status in ('succeeded', 'succeeded_unconfirmed', 'charged_back')
          and coalesce(confirmed_at, updated_at) >= p_from and coalesce(confirmed_at, updated_at) < p_to),
      'live_succeeded_lkr', (select coalesce(sum(amount_lkr), 0) from pa where environment = 'live' and status in ('succeeded', 'succeeded_unconfirmed', 'charged_back')
          and coalesce(confirmed_at, updated_at) >= p_from and coalesce(confirmed_at, updated_at) < p_to),
      'live_confirmed_bookings_lkr', (select coalesce(sum(amount_lkr), 0) from pa where environment = 'live' and status = 'succeeded'
          and confirmed_at >= p_from and confirmed_at < p_to),
      'non_live_succeeded_count', (select count(*) from pa where environment <> 'live' and status in ('succeeded', 'succeeded_unconfirmed')
          and updated_at >= p_from and updated_at < p_to),
      'attempts_by_status', coalesce((select jsonb_object_agg(status, n) from (
          select status, count(*) n from pa where created_at >= p_from and created_at < p_to group by 1) x), '{}'::jsonb),
      'paid_unconfirmed_open', coalesce((select jsonb_agg(jsonb_build_object('order_id', order_id, 'amount_lkr', amount_lkr, 'at', updated_at))
          from pa where status = 'succeeded_unconfirmed' and reconciliation_status = 'refund_required'), '[]'::jsonb),
      'unreconciled_open', (select count(*) from pa where reconciliation_status = 'refund_required'),
      'stuck_initiated_over_1h', (select count(*) from pa where status in ('initiated', 'pending') and created_at < now() - interval '1 hour'
          and created_at >= p_from - interval '1 day'),
      'notification_results', coalesce((select jsonb_object_agg(coalesce(result, 'unprocessed'), n) from (
          select result, count(*) n from public.payment_events where received_at >= p_from and received_at < p_to group by 1) x), '{}'::jsonb),
      'duplicate_notifications', (select coalesce(sum(duplicate_count), 0) from public.payment_events where last_seen_at >= p_from and last_seen_at < p_to)
    ),
    'refunds', jsonb_build_object(
      'awaiting_action_count', (select count(*) from public.refunds where status in ('pending', 'initiated')),
      'awaiting_action_lkr', (select coalesce(sum(amount_lkr), 0) from public.refunds where status in ('pending', 'initiated')),
      'completed_in_period_count', (select count(*) from public.refunds where status = 'completed' and completed_at >= p_from and completed_at < p_to),
      'completed_in_period_lkr', (select coalesce(sum(amount_lkr), 0) from public.refunds where status = 'completed' and completed_at >= p_from and completed_at < p_to)
    ),
    'court_operations', jsonb_build_object(
      'slots_created', (select count(*) from public.slots where created_at >= p_from and created_at < p_to),
      'blocks_added', (select count(*) from au where action = 'slot.block'),
      'blocks_removed', (select count(*) from au where action = 'slot.unblock'),
      'recurring_runs', (select count(*) from au where action = 'recurring.generate'),
      'recurring_conflict_dates', (select coalesce(sum(jsonb_array_length(details -> 'conflict_dates')), 0) from au where action = 'recurring.generate')
    ),
    'integrity', jsonb_build_object(
      'confirmed_bookings_on_unbooked_slots', (select count(*) from bk join public.slots s on s.id = bk.slot_id
          where bk.status::text in ('confirmed', 'cancellation_requested') and s.status::text <> 'booked'),
      'booked_slots_without_live_booking', (select count(*) from public.slots s where s.status::text = 'booked'
          and not exists (select 1 from bk where bk.slot_id = s.id and bk.status::text in ('confirmed', 'cancellation_requested'))),
      'overlapping_active_slots', (select count(*) from public.slots a join public.slots b
          on a.court_id = b.court_id and a.id < b.id and b.slot_date between a.slot_date - 1 and a.slot_date + 1
          where a.status::text in ('locked', 'booked') and b.status::text in ('locked', 'booked')
            and public.slot_period(a.slot_date, a.start_time, a.end_time) && public.slot_period(b.slot_date, b.start_time, b.end_time)
            and public.slot_parts(a.court_type::text) && public.slot_parts(b.court_type::text))
    ),
    'technical', jsonb_build_object(
      'events_by_severity', coalesce((select jsonb_object_agg(severity, n) from (select severity, count(*) n from ev group by 1) x), '{}'::jsonb),
      'events_by_category', coalesce((select jsonb_object_agg(category || ':' || event, n) from (
          select category, event, count(*) n from ev where severity in ('error', 'critical') group by 1, 2) x), '{}'::jsonb),
      'unresolved_action_items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'severity', severity, 'category', category,
          'event', event, 'ref', correlation_id, 'at', created_at) order by created_at)
          from (select * from public.app_events where requires_action and resolved_at is null order by created_at desc limit 50) u), '[]'::jsonb),
      'sms_failed', (select count(*) from public.notification_log where channel = 'sms' and status = 'failed' and updated_at >= p_from and updated_at < p_to),
      'sms_accepted', (select count(*) from public.notification_log where channel = 'sms' and status = 'accepted' and updated_at >= p_from and updated_at < p_to),
      'email_failed', (select count(*) from public.notification_log where channel = 'email' and status = 'failed' and updated_at >= p_from and updated_at < p_to),
      'otp_sms_failed', (select count(*) from public.phone_otp_challenges where sms_status = 'failed' and created_at >= p_from and created_at < p_to),
      'failed_jobs', coalesce((select jsonb_agg(jsonb_build_object('job', job_name, 'period', period_key, 'error', last_error))
          from public.job_runs where status = 'failed' and started_at >= p_from - interval '1 day'), '[]'::jsonb)
    ),
    'admin', jsonb_build_object(
      'actions_by_type', coalesce((select jsonb_object_agg(action, n) from (
          select action, count(*) n from au where actor_kind = 'admin' group by 1) x), '{}'::jsonb)
    )
  ) into v;
  return v;
end $$;
revoke all on function public.report_daily(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.report_daily(timestamptz, timestamptz) to service_role;

-- Housekeeping called by the daily job: expired holds, old rate-limit windows.
create or replace function public.daily_housekeeping()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_holds integer;
  v_limits integer;
begin
  v_holds := public.expire_stale_holds();
  delete from public.rate_limits where window_start < now() - interval '2 days';
  get diagnostics v_limits = row_count;
  return jsonb_build_object('expired_holds_released', v_holds, 'rate_limit_rows_deleted', v_limits);
end $$;
revoke all on function public.daily_housekeeping() from public, anon, authenticated;
grant execute on function public.daily_housekeeping() to service_role;
