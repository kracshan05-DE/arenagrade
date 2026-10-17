import { db } from '@/lib/server/db'
import { env } from '@/lib/server/env'
import { authenticate, correlationId, json, readJson, sameOrigin, unauthorized, dbErrorResponse } from '@/lib/server/http'
import { applyNotification, afterNotification, eventKey } from '@/lib/server/payments'

// POST /api/payments/simulate  { orderId, outcome: 'success' | 'failed' | 'cancelled' }
// NON-PRODUCTION TESTING ONLY. Returns 404 unless PAYMENT_SIMULATION=enabled,
// the deployment is not production and PayHere is not in live mode. It feeds
// the same database function as real PayHere notifications, tagged as
// provider "simulator", which can never settle a real PayHere order.
const STATUS = { success: 2, failed: -2, cancelled: -1 } as const

export async function POST(req: Request) {
  if (!env.paymentSimulationAllowed()) return new Response('Not Found', { status: 404 })
  const cid = correlationId(req)
  if (!sameOrigin(req, env.siteUrl())) return json({ error: 'forbidden' }, 403)
  const auth = await authenticate(req)
  if (!auth) return unauthorized()

  const body = await readJson<{ orderId?: unknown; outcome?: unknown }>(req)
  const orderId = typeof body?.orderId === 'string' ? body.orderId : ''
  const outcome = body?.outcome as keyof typeof STATUS
  if (!orderId || !(outcome in STATUS)) return json({ error: 'invalid_input' }, 400)

  try {
    const attempt = await db().getPaymentAttempt(orderId)
    if (!attempt || attempt.user_id !== auth.user.id || attempt.provider !== 'simulator') return json({ error: 'not_found' }, 404)
    const r = await applyNotification({
      provider: 'simulator', orderId, providerPaymentId: `SIM-${orderId}`, statusCode: STATUS[outcome],
      amount: attempt.amount_lkr, currency: attempt.currency, signatureValid: true,
      eventKey: eventKey(['simulator', orderId, outcome]), payload: { simulated: true, outcome },
    })
    await afterNotification(r, cid)
    return json({ result: r.result, booking_id: r.booking_id ?? null })
  } catch (e) {
    return dbErrorResponse(e, cid, {})
  }
}
