import { db } from '@/lib/server/db'
import { env } from '@/lib/server/env'
import { authenticate, correlationId, json, readJson, sameOrigin, unauthorized, dbErrorResponse } from '@/lib/server/http'
import { PAYHERE_CHECKOUT_URL, checkoutHash } from '@/lib/server/payhere'
import { recordEvent } from '@/lib/server/alerts'
import { COURT_TYPE_LABEL } from '@/lib/server/notify/templates'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/payments/initiate  { slotId }
// The browser sends only the slot it holds. The server decides the amount
// (from the slot row), the order id and the provider, and signs the PayHere
// request with the merchant secret, which never leaves the server.
export async function POST(req: Request) {
  const cid = correlationId(req)
  if (!sameOrigin(req, env.siteUrl())) return json({ error: 'forbidden' }, 403)
  const auth = await authenticate(req)
  if (!auth) return unauthorized()

  const body = await readJson<{ slotId?: unknown }>(req)
  const slotId = typeof body?.slotId === 'string' ? body.slotId : ''
  if (!UUID.test(slotId)) return json({ error: 'invalid_input' }, 400)

  const merchantId = env.payhereMerchantId()
  const merchantSecret = env.payhereMerchantSecret()
  const payhereReady = Boolean(merchantId && merchantSecret)
  if (!payhereReady && !env.paymentSimulationAllowed()) {
    await recordEvent({ severity: 'error', category: 'payment', event: 'payments_unavailable', correlationId: cid, requiresAction: true })
    return json({ error: 'payments_unavailable' }, 503)
  }

  try {
    const limit = await db().rpcAsService<{ allowed: boolean; retry_after_seconds: number }>('rate_limit_hit', {
      p_key: `pay_init:${auth.user.id}`, p_window_seconds: 600, p_max: 20,
    })
    if (!limit.allowed) return json({ error: 'rate_limited', retry_after_seconds: limit.retry_after_seconds }, 429)

    const provider = payhereReady ? 'payhere' : 'simulator'
    const environment = payhereReady ? env.payhereMode() : 'test'
    const attempt = await db().rpcAsService<{ order_id: string; amount: string; currency: string; hold_expires_at: string }>(
      'payment_create_attempt', { p_user_id: auth.user.id, p_slot_id: slotId, p_provider: provider, p_environment: environment })

    if (provider === 'simulator') {
      return json({ mode: 'simulation', order_id: attempt.order_id, amount: attempt.amount, hold_expires_at: attempt.hold_expires_at })
    }

    const [profile, email, slot] = await Promise.all([
      db().getProfile(auth.user.id), db().getUserEmail(auth.user.id), db().getSlotSummary(slotId),
    ])
    const names = (profile?.full_name ?? '').trim().split(/\s+/).filter(Boolean)
    const site = env.siteUrl()
    const fields: Record<string, string> = {
      merchant_id: merchantId!,
      return_url: `${site}/booking/${slotId}/payment/success?order=${encodeURIComponent(attempt.order_id)}`,
      cancel_url: `${site}/booking/${slotId}/payment?cancelled=1`,
      notify_url: `${site}/api/payments/payhere/notify`,
      order_id: attempt.order_id,
      items: `${slot?.court_name ?? 'Court'} - ${COURT_TYPE_LABEL[slot?.court_type ?? ''] ?? 'Court'} ${slot?.slot_date ?? ''} ${slot?.start_time?.slice(0, 5) ?? ''}`.slice(0, 100),
      currency: attempt.currency,
      amount: attempt.amount,
      first_name: (names[0] ?? 'ArenaGrade').slice(0, 50),
      last_name: (names.slice(1).join(' ') || 'Customer').slice(0, 50),
      email: email ?? 'no-reply@arenagrade.lk',
      phone: profile?.phone ?? '',
      address: (slot?.location_address ?? 'Colombo').slice(0, 100),
      city: (slot?.location_name ?? 'Colombo').slice(0, 50),
      country: 'Sri Lanka',
    }
    fields.hash = checkoutHash(merchantId!, attempt.order_id, attempt.amount, attempt.currency, merchantSecret!)
    return json({ mode: 'payhere', action: PAYHERE_CHECKOUT_URL[env.payhereMode()], fields, hold_expires_at: attempt.hold_expires_at })
  } catch (e) {
    return dbErrorResponse(e, cid, {
      hold_invalid_or_expiring: 409, phone_not_verified: 403, slot_price_invalid: 409,
      booking_admin_only: 403, booking_closed: 403, test_payments_admin_only: 403,
    })
  }
}
