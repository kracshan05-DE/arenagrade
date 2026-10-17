import 'server-only'

// Message templates. Every interpolated value is HTML-escaped in emails and
// stripped of control characters in SMS, so names/reasons typed by users can
// never inject markup or headers.

export function escapeHtml(v: unknown) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
const clean = (v: unknown, max = 80) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
const lkr = (v: unknown) => `LKR ${Number(v ?? 0).toLocaleString('en-LK', { maximumFractionDigits: 2 })}`

export const COURT_TYPE_LABEL: Record<string, string> = { full_court: 'Full Court', half_a: 'Half Court A', half_b: 'Half Court B' }

export interface BookingFacts {
  court_name: string | null; court_type: string; slot_date: string; start_time: string; end_time: string
  amount: string | number; reference: string; location?: string | null; customer_name?: string | null
}

// ------------------------------- SMS ---------------------------------------
export const sms = {
  otp: (code: string) =>
    `Your ArenaGrade verification code is ${code}. It expires in 10 minutes. Do not share this code.`,
  bookingConfirmed: (b: BookingFacts) =>
    `ArenaGrade booking confirmed: ${clean(b.court_name)} - ${COURT_TYPE_LABEL[b.court_type] ?? 'Court'} on ${clean(b.slot_date, 10)} ${clean(b.start_time, 5)}-${clean(b.end_time, 5)}. Paid ${lkr(b.amount)}. Ref ${clean(b.reference, 40)}.`,
  paidNotConfirmed: (b: { reference: string; amount: string | number }) =>
    `ArenaGrade: we received your payment of ${lkr(b.amount)} (ref ${clean(b.reference, 40)}) after your 10-minute slot hold ended, so the booking was NOT confirmed. A full refund is being arranged; we will contact you.`,
  cancellationRequestToAdmin: (b: { customer_name: string | null; customer_phone: string | null; court_name: string | null; slot_date: string; start_time: string; end_time: string; reason: string | null }, siteUrl: string) =>
    `ArenaGrade: cancellation request from ${clean(b.customer_name || b.customer_phone, 40)} for ${clean(b.court_name)} on ${clean(b.slot_date, 10)} ${clean(b.start_time, 5)}-${clean(b.end_time, 5)}. Reason: ${clean(b.reason, 120)}. Review: ${siteUrl}/admin/bookings`,
  cancellationApproved: (b: { court_name: string | null; slot_date: string; start_time: string; amount: string | number }, whatsapp: string) =>
    `ArenaGrade: your booking for ${clean(b.court_name)} on ${clean(b.slot_date, 10)} at ${clean(b.start_time, 5)} is cancelled. Refund of ${lkr(b.amount)} is pending: please WhatsApp your bank account details to ${clean(whatsapp, 20)}.`,
  cancellationRejected: (b: { court_name: string | null; slot_date: string; start_time: string }) =>
    `ArenaGrade: your cancellation request for ${clean(b.court_name)} on ${clean(b.slot_date, 10)} at ${clean(b.start_time, 5)} was reviewed. Your booking remains confirmed. Queries: info@arenagrade.lk`,
  criticalAlert: (event: string, ref: string | null) =>
    `ArenaGrade ALERT: ${clean(event, 60)}${ref ? ` (ref ${clean(ref, 40)})` : ''}. Check the admin panel / daily report.`,
}

// ------------------------------ Email --------------------------------------
const shell = (inner: string) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:system-ui,-apple-system,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 16px;">${inner}
<div style="text-align:center;padding:16px 0;">
<p style="font-size:12px;color:#94A3B8;margin:0 0 6px;">Questions? <a href="mailto:info@arenagrade.lk" style="color:#1B6B3A;font-weight:600;">info@arenagrade.lk</a></p>
<p style="font-size:11px;color:#CBD5E1;margin:8px 0 0;">© ArenaGrade. Sri Lanka.</p></div></div></body></html>`

export function bookingConfirmedEmail(b: BookingFacts, siteUrl: string) {
  const cell = (label: string, value: string, color = '#0F172A') =>
    `<td style="padding:10px;background:#F8FAFC;width:50%;"><p style="font-size:11px;color:#94A3B8;margin:0 0 3px;">${label}</p><p style="font-size:13px;font-weight:600;color:${color};margin:0;">${value}</p></td>`
  const html = shell(`
<div style="background:#0B2818;border-radius:14px;padding:28px;margin-bottom:16px;text-align:center;">
<p style="color:#4ADE80;font-size:13px;font-weight:700;margin:0 0 16px;">ArenaGrade</p>
<h1 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 6px;">Booking Confirmed</h1>
<p style="color:rgba(255,255,255,0.6);font-size:14px;margin:0;">Your payment was verified and your court is booked.</p></div>
<div style="background:#fff;border-radius:14px;border:0.5px solid #E2E8F0;padding:24px;margin-bottom:16px;">
<p style="font-size:16px;font-weight:700;color:#0F172A;margin:0 0 4px;">${escapeHtml(b.court_name)}</p>
<p style="font-size:13px;color:#64748B;margin:0 0 16px;">${escapeHtml(b.location ?? '')}</p>
<table style="width:100%;border-collapse:separate;border-spacing:4px;margin-bottom:16px;">
<tr>${cell('DATE', escapeHtml(b.slot_date))}${cell('TIME', `${escapeHtml(b.start_time)} - ${escapeHtml(b.end_time)}`)}</tr>
<tr>${cell('COURT TYPE', escapeHtml(COURT_TYPE_LABEL[b.court_type] ?? b.court_type))}${cell('AMOUNT PAID', escapeHtml(lkr(b.amount)), '#1B6B3A')}</tr>
</table>
<p style="font-size:11px;color:#94A3B8;margin:0 0 2px;">BOOKING REFERENCE</p>
<p style="font-size:12px;font-weight:600;color:#0F172A;margin:0;font-family:monospace;">${escapeHtml(b.reference)}</p></div>
<div style="background:#FFFBEB;border:0.5px solid #FDE68A;border-radius:12px;padding:16px;">
<p style="font-size:13px;font-weight:600;color:#92400E;margin:0 0 4px;">Cancellation policy</p>
<p style="font-size:12px;color:#92400E;margin:0;line-height:1.6;">Cancellation requests are accepted up to 24 hours before your slot (full refund by bank transfer once approved).
Requests are made from My Bookings at ${escapeHtml(siteUrl)}.</p></div>`)
  const text = `Booking confirmed: ${b.court_name} ${COURT_TYPE_LABEL[b.court_type] ?? ''} on ${b.slot_date} ${b.start_time}-${b.end_time}. Paid ${lkr(b.amount)}. Ref ${b.reference}.`
  return { subject: `Booking confirmed - ${clean(b.court_name)} on ${clean(b.slot_date, 10)}`, html, text }
}

export function cancellationApprovedEmail(b: { court_name: string | null; slot_date: string; start_time: string; amount: string | number }, whatsapp: string) {
  const html = shell(`<div style="background:#fff;border-radius:14px;border:0.5px solid #E2E8F0;padding:28px;text-align:center;">
<h1 style="font-size:20px;font-weight:700;color:#0F172A;margin:0 0 8px;">Booking Cancelled</h1>
<p style="font-size:14px;color:#64748B;margin:0 0 20px;">Your booking for ${escapeHtml(b.court_name)} on ${escapeHtml(b.slot_date)} at ${escapeHtml(b.start_time)} has been cancelled.</p>
<div style="background:#ECFDF5;border-radius:10px;padding:16px;text-align:left;">
<p style="font-size:13px;font-weight:600;color:#065F46;margin:0 0 6px;">Refund pending: ${escapeHtml(lkr(b.amount))}</p>
<p style="font-size:12px;color:#047857;margin:0;">Please WhatsApp your bank account details to <strong>${escapeHtml(whatsapp)}</strong>. We will confirm once the transfer is made.</p></div></div>`)
  return { subject: 'Booking cancelled - refund pending', html, text: sms.cancellationApproved(b, whatsapp) }
}

export function cancellationRejectedEmail(b: { court_name: string | null; slot_date: string; start_time: string }) {
  const html = shell(`<div style="background:#fff;border-radius:14px;border:0.5px solid #E2E8F0;padding:28px;text-align:center;">
<h1 style="font-size:20px;font-weight:700;color:#0F172A;margin:0 0 8px;">Booking Remains Confirmed</h1>
<p style="font-size:14px;color:#64748B;margin:0;">Your cancellation request for ${escapeHtml(b.court_name)} on ${escapeHtml(b.slot_date)} at ${escapeHtml(b.start_time)} was reviewed. Your booking remains confirmed.</p></div>`)
  return { subject: `Your booking remains confirmed - ${clean(b.court_name)}`, html, text: sms.cancellationRejected(b) }
}

// ------------------------- Daily operations report --------------------------
type Report = Record<string, Record<string, unknown>> & { period: { from: string; to: string } }

export function dailyReportEmail(r: Report, periodLabel: string, siteUrl: string) {
  const n = (v: unknown) => Number(v ?? 0)
  const p = r.payments, b = r.bookings, f = r.refunds, c = r.court_operations, i = r.integrity, t = r.technical, a = r.admin
  const gross = n(p.live_succeeded_lkr)
  const refunded = n(f.completed_in_period_lkr)
  const actions: string[] = []
  const unconfirmed = (p.paid_unconfirmed_open as unknown[]) ?? []
  if (unconfirmed.length) actions.push(`${unconfirmed.length} payment(s) received without a confirmed booking — refund required.`)
  if (n(f.awaiting_action_count)) actions.push(`${n(f.awaiting_action_count)} refund(s) awaiting manual transfer (${lkr(f.awaiting_action_lkr)}).`)
  if (n(b.pending_cancellation_requests_now)) actions.push(`${n(b.pending_cancellation_requests_now)} cancellation request(s) awaiting a decision.`)
  if (n(i.overlapping_active_slots) || n(i.confirmed_bookings_on_unbooked_slots) || n(i.booked_slots_without_live_booking))
    actions.push('Booking integrity check found inconsistencies — investigate immediately.')
  const unresolved = (t.unresolved_action_items as { severity: string; category: string; event: string; ref: string | null }[]) ?? []
  if (unresolved.length) actions.push(`${unresolved.length} unresolved incident(s) need attention.`)
  if ((t.failed_jobs as unknown[])?.length) actions.push('A scheduled job failed recently.')
  if (n(t.sms_failed) || n(t.otp_sms_failed)) actions.push(`SMS failures: ${n(t.sms_failed)} notifications, ${n(t.otp_sms_failed)} OTP codes.`)
  if (n(t.email_failed)) actions.push(`${n(t.email_failed)} email(s) failed.`)

  const row = (k: string, v: unknown) => `<tr><td style="padding:6px 0;color:#64748B;font-size:13px;">${escapeHtml(k)}</td><td style="padding:6px 0;text-align:right;font-weight:600;color:#0F172A;font-size:13px;">${escapeHtml(v)}</td></tr>`
  const section = (title: string, rows: string) => `<div style="background:#fff;border-radius:12px;border:0.5px solid #E2E8F0;padding:18px 20px;margin-bottom:12px;">
<p style="font-size:11px;color:#94A3B8;font-weight:600;letter-spacing:0.05em;margin:0 0 8px;">${escapeHtml(title)}</p><table style="width:100%;border-collapse:collapse;">${rows}</table></div>`
  const kv = (o: unknown) => Object.entries((o as Record<string, unknown>) ?? {}).map(([k, v]) => row(k, v)).join('') || row('none', '—')
  const quiet = n(b.created) === 0 && n(p.live_succeeded_count) === 0 && !actions.length

  const html = shell(`
<div style="background:#0B2818;border-radius:14px;padding:24px;margin-bottom:12px;">
<p style="color:#4ADE80;font-size:12px;font-weight:700;margin:0 0 6px;">ArenaGrade · Daily Operations Report</p>
<h1 style="color:#fff;font-size:20px;margin:0 0 4px;">${escapeHtml(periodLabel)}</h1>
<p style="color:rgba(255,255,255,0.6);font-size:12px;margin:0;">Period ${escapeHtml(r.period.from)} → ${escapeHtml(r.period.to)} (Asia/Colombo report day)</p></div>
<div style="background:${actions.length ? '#FEF2F2' : '#ECFDF5'};border:0.5px solid ${actions.length ? '#FECACA' : '#6EE7B7'};border-radius:12px;padding:16px 20px;margin-bottom:12px;">
<p style="font-size:13px;font-weight:700;color:${actions.length ? '#991B1B' : '#065F46'};margin:0 0 6px;">${actions.length ? 'Action required' : 'No action required'}</p>
${actions.length ? `<ul style="margin:0;padding-left:18px;color:#7F1D1D;font-size:13px;line-height:1.6;">${actions.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : `<p style="margin:0;color:#065F46;font-size:13px;">${quiet ? 'There were no bookings, payments or incidents in this period.' : 'Everything reconciled.'}</p>`}</div>
${section('PAYMENTS (LIVE, VERIFIED, DEDUPLICATED)',
    row('Successful payments', n(p.live_succeeded_count)) + row('Gross received', lkr(gross)) +
    row('Refunds completed in period', lkr(refunded)) + row('Net (gross − refunds completed)', lkr(gross - refunded)) +
    row('Of which confirmed as bookings', lkr(p.live_confirmed_bookings_lkr)) + row('Unreconciled payments (open)', n(p.unreconciled_open)) +
    row('Attempts stuck > 1h', n(p.stuck_initiated_over_1h)) + row('Duplicate provider notifications', n(p.duplicate_notifications)) +
    row('Test/sandbox successes (not revenue)', n(p.non_live_succeeded_count)))}
${section('PAYMENT ATTEMPTS BY STATUS', kv(p.attempts_by_status))}
${section('NOTIFICATION RESULTS', kv(p.notification_results))}
${section('BOOKINGS', row('Bookings created', n(b.created)) + row('Holds created', n(b.holds_created)) +
    row('Holds confirmed by payment', n(b.holds_confirmed)) + row('Holds released by customer', n(b.holds_released_by_customer)) +
    row('Active holds now', n(b.active_holds_now)) + row('Cancellation requests', n(b.cancellation_requests)) +
    row('Cancellations approved / rejected', `${n(b.cancellations_approved)} / ${n(b.cancellations_rejected)}`))}
${section('REFUNDS', row('Awaiting manual action', `${n(f.awaiting_action_count)} (${lkr(f.awaiting_action_lkr)})`) +
    row('Completed in period', `${n(f.completed_in_period_count)} (${lkr(f.completed_in_period_lkr)})`))}
${section('COURT OPERATIONS', row('Slots created', n(c.slots_created)) + row('Practice blocks added / removed', `${n(c.blocks_added)} / ${n(c.blocks_removed)}`) +
    row('Recurring generations', n(c.recurring_runs)) + row('Recurring dates skipped (clash)', n(c.recurring_conflict_dates)))}
${section('BOOKING INTEGRITY (MUST BE 0)', row('Overlapping active slots', n(i.overlapping_active_slots)) +
    row('Live bookings on un-booked slots', n(i.confirmed_bookings_on_unbooked_slots)) + row('Booked slots without a booking', n(i.booked_slots_without_live_booking)))}
${section('TECHNICAL HEALTH', row('SMS accepted by provider / failed', `${n(t.sms_accepted)} / ${n(t.sms_failed)}`) +
    row('OTP SMS failed', n(t.otp_sms_failed)) + row('Emails failed', n(t.email_failed)) + kv(t.events_by_category))}
${unresolved.length ? section('UNRESOLVED INCIDENTS', unresolved.map((u) => row(`${u.severity} · ${u.category}`, `${u.event}${u.ref ? ` (${u.ref})` : ''}`)).join('')) : ''}
${section('ADMIN ACTIONS', kv(a.actions_by_type))}
<p style="font-size:11px;color:#94A3B8;margin:8px 0 0;">"Accepted by provider" means Text.lk took the message, not that the handset received it. Details: ${escapeHtml(siteUrl)}/admin</p>`)

  const text = [`ArenaGrade Daily Operations Report — ${periodLabel}`, actions.length ? `ACTION REQUIRED:\n- ${actions.join('\n- ')}` : 'No action required.',
    `Live payments: ${n(p.live_succeeded_count)}, gross ${lkr(gross)}, refunds completed ${lkr(refunded)}, net ${lkr(gross - refunded)}.`,
    `Bookings created: ${n(b.created)}.`].join('\n\n')
  return { subject: `ArenaGrade Daily Operations Report — ${periodLabel}`, html, text, actionCount: actions.length }
}
