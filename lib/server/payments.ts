import 'server-only'
import { createHash } from 'node:crypto'
import { db } from './db'
import { env } from './env'
import { log } from './log'
import { recordEvent, sendCriticalAlert } from './alerts'
import { sendSms } from './notify/sms'
import { sendEmail } from './notify/email'
import { sms, bookingConfirmedEmail } from './notify/templates'

export interface ApplyResult {
  result: string; order_id: string; booking_id?: string | null; user_id?: string; slot_id?: string; slot_ids?: string[]; amount?: string
}

export function eventKey(parts: (string | number | null | undefined)[]) {
  return createHash('sha256').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex')
}

/** Apply a provider notification through the single authoritative DB function. */
export async function applyNotification(p: {
  provider: 'payhere' | 'simulator'; orderId: string; providerPaymentId: string | null; statusCode: number
  amount: string; currency: string; signatureValid: boolean; eventKey: string; payload: Record<string, unknown>
}) {
  return db().rpcAsService<ApplyResult>('payment_apply_notification', {
    p_provider: p.provider, p_order_id: p.orderId, p_provider_payment_id: p.providerPaymentId,
    p_status_code: p.statusCode, p_amount: p.amount, p_currency: p.currency,
    p_signature_valid: p.signatureValid, p_event_key: p.eventKey, p_payload: p.payload,
  })
}

/**
 * Side effects after the database has committed a result. Failures here are
 * logged and recorded but never change the payment/booking outcome.
 */
export async function afterNotification(r: ApplyResult, cid: string) {
  try {
    if (r.result === 'confirmed' && r.user_id && r.slot_id) {
      const ids = r.slot_ids?.length ? r.slot_ids : [r.slot_id]
      const [profile, email, ...slots] = await Promise.all([
        db().getProfile(r.user_id), db().getUserEmail(r.user_id), ...ids.map((id) => db().getSlotSummary(id)),
      ])
      const hours = slots.filter((x): x is NonNullable<typeof x> => Boolean(x))
        .sort((a, b) => (a.slot_date + a.start_time).localeCompare(b.slot_date + b.start_time))
      if (!hours.length) return
      const slot = hours[0]
      const facts = {
        court_name: slot.court_name, court_type: slot.court_type, slot_date: slot.slot_date,
        start_time: slot.start_time.slice(0, 5), end_time: hours[hours.length - 1].end_time.slice(0, 5),
        amount: r.amount ?? '0', reference: r.order_id, location: slot.location_name, customer_name: profile?.full_name,
      }
      await sendSms({
        template: 'booking_confirmed', to: profile?.phone, body: sms.bookingConfirmed(facts),
        idempotencyKey: `sms:booking_confirmed:${r.order_id}`, relatedType: 'booking', relatedId: r.booking_id ?? r.order_id,
      })
      if (email) {
        const m = bookingConfirmedEmail(facts, env.siteUrl())
        await sendEmail({
          template: 'booking_confirmed', to: [email], subject: m.subject, html: m.html, text: m.text,
          idempotencyKey: `email:booking_confirmed:${r.order_id}`, relatedType: 'booking', relatedId: r.booking_id ?? r.order_id,
        })
      }
    } else if (r.result === 'paid_unconfirmed' && r.user_id) {
      // The database already stored the critical event; alert immediately.
      await sendCriticalAlert('paid_without_booking', r.order_id)
      const profile = await db().getProfile(r.user_id)
      await sendSms({
        template: 'paid_not_confirmed', to: profile?.phone,
        body: sms.paidNotConfirmed({ reference: r.order_id, amount: r.amount ?? '0' }),
        idempotencyKey: `sms:paid_not_confirmed:${r.order_id}`, relatedType: 'payment', relatedId: r.order_id,
      })
    } else if (['unknown_order', 'amount_mismatch', 'malformed', 'provider_mismatch', 'charged_back'].includes(r.result)) {
      await sendCriticalAlert(`payment_${r.result}`, r.order_id)
    }
  } catch (e) {
    log('error', 'after_notification_failed', { cid, order: r.order_id, error: (e as Error).message })
    await recordEvent({ severity: 'error', category: 'notification', event: 'post_payment_notify_failed', correlationId: r.order_id, details: { cid } })
  }
}
