import { db } from '@/lib/server/db'
import { env } from '@/lib/server/env'
import { authenticate, correlationId, json, readJson, sameOrigin, unauthorized, dbErrorResponse } from '@/lib/server/http'
import { sendSms } from '@/lib/server/notify/sms'
import { sms } from '@/lib/server/notify/templates'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Notice = {
  changed: boolean; customer_name: string | null; customer_phone: string | null; court_name: string | null
  slot_date: string; start_time: string; end_time: string; reason: string | null
}

// POST /api/bookings/:id/cancel  { reason }
// The database checks ownership, status and the 24-hour rule (Asia/Colombo).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const cid = correlationId(req)
  if (!sameOrigin(req, env.siteUrl())) return json({ error: 'forbidden' }, 403)
  const auth = await authenticate(req)
  if (!auth) return unauthorized()
  const { id } = await ctx.params
  if (!UUID.test(id)) return json({ error: 'invalid_input' }, 400)
  const body = await readJson<{ reason?: unknown }>(req)
  const reason = typeof body?.reason === 'string' ? body.reason : ''

  try {
    const r = await db().rpcAsUser<Notice>(auth.token, 'request_booking_cancellation', { p_booking_id: id, p_reason: reason })
    if (r.changed) {
      await sendSms({
        template: 'cancellation_request_admin', to: env.adminPhone(),
        body: sms.cancellationRequestToAdmin(r, env.siteUrl()),
        idempotencyKey: `sms:cancel_request:${id}:${new Date().toISOString().slice(0, 16)}`, relatedType: 'booking', relatedId: id,
      })
    }
    return json({ status: r.changed ? 'requested' : 'already_requested' })
  } catch (e) {
    return dbErrorResponse(e, cid, {
      booking_not_found: 404, booking_not_cancellable: 409, cancellation_window_closed: 409, invalid_reason: 400, not_authenticated: 401,
    })
  }
}
