import { env } from '@/lib/server/env'
import { correlationId } from '@/lib/server/http'
import { parseNotification, verifyNotification, sanitizedPayload } from '@/lib/server/payhere'
import { applyNotification, afterNotification, eventKey } from '@/lib/server/payments'
import { recordEvent } from '@/lib/server/alerts'
import { log } from '@/lib/server/log'

// POST /api/payments/payhere/notify — PayHere server-to-server callback.
// This is the ONLY production path that can confirm a booking. The signature
// (md5sig) and merchant id are verified; the database then checks the order,
// amount, currency and that the customer's hold is still valid, and processes
// each notification exactly once.
export async function POST(req: Request) {
  const cid = correlationId(req)
  const merchantId = env.payhereMerchantId()
  const merchantSecret = env.payhereMerchantSecret()
  if (!merchantId || !merchantSecret) {
    await recordEvent({ severity: 'critical', category: 'payment', event: 'notify_received_but_payhere_not_configured', correlationId: cid })
    return new Response('not configured', { status: 503 })
  }

  const raw = await req.text()
  if (raw.length > 10_000) return new Response('too large', { status: 413 })
  const n = parseNotification(new URLSearchParams(raw))
  if (!n) {
    await recordEvent({ severity: 'warning', category: 'payment', event: 'notify_malformed', correlationId: cid })
    return new Response('bad request', { status: 400 })
  }

  const valid = verifyNotification(n, merchantId, merchantSecret)
  try {
    const r = await applyNotification({
      provider: 'payhere', orderId: n.order_id, providerPaymentId: n.payment_id, statusCode: Number(n.status_code),
      amount: n.payhere_amount, currency: n.payhere_currency, signatureValid: valid,
      eventKey: eventKey(['payhere', n.order_id, n.payment_id, n.status_code, n.payhere_amount, n.payhere_currency, n.md5sig]),
      payload: sanitizedPayload(n),
    })
    log('info', 'payhere_notify', { cid, order: n.order_id, status_code: n.status_code, result: r.result })
    await afterNotification(r, cid)
    if (r.result === 'invalid_signature') return new Response('invalid signature', { status: 400 })
    return new Response('OK', { status: 200 })
  } catch (e) {
    // Database failure: PayHere may retry; the event was not recorded, so a
    // retry will be processed normally. Alert now — money may have moved.
    await recordEvent({
      severity: 'critical', category: 'payment', event: 'notify_processing_failed', correlationId: n.order_id,
      details: { cid, error: (e as Error).message, status_code: n.status_code },
    })
    return new Response('error', { status: 500 })
  }
}
